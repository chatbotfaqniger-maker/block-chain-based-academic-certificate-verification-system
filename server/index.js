import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createVerityMarketingMp4 } from "./marketing-video.js";
import { connectChain, chainStatus, issueOnChain, revokeOnChain, verifyOnChain } from "./chain.js";
import { scanBuffer } from "./malware-scanner.js";
import { STAFF_PERMISSIONS, isValidStaffPermissions, hasStaffPermission } from "./staff-permissions.js";

const app = express();
const PORT = Number(process.env.PORT || 8080);
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "";
const root = path.dirname(fileURLToPath(import.meta.url));
const configured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
const makeClient = (accessToken) => {
  if (!configured) throw new Error("Supabase is not configured. Add the Project URL and Publishable Key.");
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {})
  });
};
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const canonical = c => JSON.stringify({
  certificateId:c.certificateId, studentName:c.studentName.trim(), studentNumber:c.studentNumber.trim(),
  institution:c.institution.trim(), faculty:c.faculty.trim(), department:c.department.trim(),
  programme:c.programme.trim(), qualification:c.qualification.trim(), classification:c.classification||"",
  awardDate:new Date(c.awardDate).toISOString()
});
const safe = u => ({id:u.id,fullName:u.fullName,email:u.email,role:u.role,institution:u.institution});
async function ensureOrganization(client, authUser, profile) {
 if(profile.role!=="EMPLOYER") return null;
 const {data:found,error}=await client.from("Organization").select("*").eq("ownerId",profile.id).maybeSingle();
 if(error) throw error;
 if(found) return found;
 const m=authUser.user_metadata||{}, name=String(m.organizationName||m.institution||profile.institution||"").trim();
 if(name.length<2) return null;
 const registrationNumber=String(m.registrationNumber||"").trim()||null;
 if(registrationNumber) {
   const {data:claimed,error:lookupError}=await client.from("Organization").select("id,ownerId").eq("registrationNumber",registrationNumber).maybeSingle();
   if(lookupError) throw lookupError;
   if(claimed && claimed.ownerId!==profile.id) throw new Error("This registration number is already linked to another Verity organization account. Sign in with the account that originally registered the organization, or contact the Verity System Administrator to resolve account ownership.");
   if(claimed && claimed.ownerId===profile.id) {
     const {data,error:reloadError}=await client.from("Organization").select("*").eq("id",claimed.id).single();
     if(reloadError) throw reloadError;
     return data;
   }
 }
 const org={id:crypto.randomUUID(),name,type:m.organizationType==="EMPLOYER"?"EMPLOYER":"INSTITUTION",ownerId:profile.id,status:"PENDING",registrationCode:"VRT-"+crypto.randomBytes(4).toString("hex").toUpperCase(),registrationNumber,officialWebsite:m.officialWebsite||null,officialEmailDomain:m.officialEmailDomain||null,accreditationBody:m.accreditationBody||null};
 const {data,error:e}=await client.from("Organization").insert(org).select().single();
 if(e && e.code==="23505" && /organization_registration_number_unique/.test(e.message||"")) throw new Error("This registration number is already registered in Verity. Sign in with the original organization account or contact the System Administrator. No duplicate organization was created.");
 if(e) throw e;
 return data;
}
async function ensureStudentMembership(client, authUser, profile) {
 if(profile.role!=="GRADUATE")return; const code=String(authUser.user_metadata?.organizationCode||"").trim().toUpperCase();if(!code)return;
 const {error}=await client.rpc("request_verity_membership",{p_registration_code:code,p_student_number:authUser.user_metadata?.studentNumber||null});
 if(error) console.warn("Student institution-link request was not accepted:",error.message);
}
const run = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
app.set("trust proxy",1);
app.use(helmet({contentSecurityPolicy:false}));
app.use(cors({origin:process.env.CORS_ORIGIN?.split(",")||true}));
app.use(express.json({limit:"1mb"}));
app.use("/api/auth",rateLimit({windowMs:900000,limit:20}));

async function profileFor(client, authUser) {
  const {data,error}=await client.from("User").select("id,fullName,email,role,institution").eq("id",authUser.id).maybeSingle();
  if(error) throw error;
  if(!data) throw new Error("Your Verity profile is not ready yet. Confirm your email, then sign in again.");
  return data;
}
async function auth(req,res,next) {
  try {
    const accessToken=req.headers.authorization?.replace(/^Bearer\s+/i,"");
    if(!accessToken) return res.status(401).json({error:"Please sign in."});
    const client=makeClient(accessToken);
    const {data,error}=await client.auth.getUser(accessToken);
    if(error||!data.user) return res.status(401).json({error:"Your session has expired. Please sign in again."});
    req.supabase=client;
    req.authUser=data.user;
    req.user=await profileFor(client,data.user);
    next();
  } catch(e) { res.status(401).json({error:e.message||"Authentication failed."}); }
}
const roles=(...allowed)=>(req,res,next)=>allowed.includes(req.user.role)?next():res.status(403).json({error:"Permission denied."});
async function activeStaffFor(client,userId) {
 const {data:staff,error}=await client.from("OrganizationStaff").select("id,organizationId,permissions,status").eq("userId",userId).eq("status","ACTIVE");
 if(error) throw error;
 const rows=staff||[];
 if(!rows.length)return [];
 const organizationIds=[...new Set(rows.map(x=>x.organizationId))];
 const {data:organizations,error:orgError}=await client.from("Organization").select("id,status").in("id",organizationIds);
 if(orgError)throw orgError;
 const approved=new Set((organizations||[]).filter(x=>x.status==="APPROVED").map(x=>x.id));
 return rows.filter(x=>approved.has(x.organizationId));
}
const staffForOrganization=(staff,organizationId)=>staff.find(x=>x.organizationId===organizationId)||null;
async function audit(client,actorId,action,entity,entityId,metadata={}) {
  const {error}=await client.from("AuditEvent").insert({id:crypto.randomUUID(),actorId,action,entity,entityId,metadata,createdAt:new Date().toISOString()});
  if(error) throw error;
}

app.get("/api/health",(_q,s)=>s.json({status:"ok",database:configured?"supabase_data_api_configured":"not_configured",blockchain:chainStatus(),malwareScanning:{provider:"ClamAV",configured:Boolean(process.env.CLAMAV_HOST?.trim()),enforcement:"quarantine_until_clean"}}));

app.post("/api/auth/register",run(async(q,s)=>{
  const b=z.object({fullName:z.string().min(2),email:z.string().email(),password:z.string().min(10),role:z.enum(["GRADUATE","EMPLOYER"]),institution:z.string().optional(),organizationName:z.string().optional(),organizationType:z.enum(["INSTITUTION","EMPLOYER"]).optional(),registrationNumber:z.string().max(100).optional(),officialWebsite:z.string().max(300).optional(),officialEmailDomain:z.string().max(150).optional(),accreditationBody:z.string().max(200).optional(),organizationCode:z.string().optional(),studentNumber:z.string().optional()}).parse(q.body); if(b.role==="EMPLOYER"&&String(b.organizationName||b.institution||"").trim().length<2)return s.status(400).json({error:"Enter your organization name."});
  const client=makeClient();
  const {data,error}=await client.auth.signUp({
    email:b.email.trim().toLowerCase(),password:b.password,
    options:{data:{fullName:b.fullName.trim(),institution:b.institution?.trim()||"",role:b.role,organizationName:b.organizationName?.trim()||"",organizationType:b.organizationType||"INSTITUTION",registrationNumber:b.registrationNumber?.trim()||"",officialWebsite:b.officialWebsite?.trim()||"",officialEmailDomain:b.officialEmailDomain?.trim().toLowerCase()||"",accreditationBody:b.accreditationBody?.trim()||"",organizationCode:b.organizationCode?.trim().toUpperCase()||"",studentNumber:b.studentNumber?.trim()||""}}
  });
  if(error) {
    const duplicate=/already registered|already exists|user exists/i.test(error.message||"");
    return s.status(duplicate?409:400).json({error:duplicate?"An account using this email already exists. Please sign in, or use account recovery if you cannot access it.":error.message});
  }
  if(Array.isArray(data.user?.identities)&&data.user.identities.length===0) return s.status(409).json({error:"An account using this email already exists. Please sign in instead of creating another account."});
  if(!data.session) return s.status(201).json({pendingEmailConfirmation:true,message:"Your account request was accepted. Check your email if confirmation is enabled, then sign in."});
  const profile=await profileFor(client,data.user); const organization=await ensureOrganization(client,data.user,profile); await ensureStudentMembership(client,data.user,profile);
  s.status(201).json({token:data.session.access_token,user:safe(profile),organization});
}));

app.post("/api/auth/login",run(async(q,s)=>{
  const b=z.object({email:z.string().email(),password:z.string().min(1)}).parse(q.body);
  const client=makeClient();
  const {data,error}=await client.auth.signInWithPassword({email:b.email.trim().toLowerCase(),password:b.password});
  if(error||!data.session) return s.status(401).json({error:error?.message||"Email confirmation may still be required."});
  const profile=await profileFor(client,data.user); const organization=await ensureOrganization(client,data.user,profile); await ensureStudentMembership(client,data.user,profile);
  s.json({token:data.session.access_token,user:safe(profile),organization});
}));
app.get("/api/auth/me",auth,run(async(q,s)=>{const organization=await ensureOrganization(q.supabase,q.authUser,q.user);await ensureStudentMembership(q.supabase,q.authUser,q.user);const organizationStaff=q.user.role==="GRADUATE"?await activeStaffFor(q.supabase,q.user.id):[];s.json({user:{...safe(q.user),organizationStaff},organization});}));
app.patch("/api/admin/profile",auth,roles("ADMIN"),run(async(q,s)=>{const b=z.object({fullName:z.string().trim().min(2).max(100)}).parse(q.body);const {data,error}=await q.supabase.from("User").update({fullName:b.fullName}).eq("id",q.user.id).select("id,fullName,email,role,institution").single();if(error)throw error;await audit(q.supabase,q.user.id,"ADMIN_PROFILE_NAME_UPDATED","User",q.user.id,{fullName:b.fullName});s.json({user:safe(data),message:"Administrator display name updated."});}));
app.post("/api/organization/request-membership",auth,roles("GRADUATE"),run(async(q,s)=>{const b=z.object({registrationCode:z.string().min(6),studentNumber:z.string().optional()}).parse(q.body);const {data,error}=await q.supabase.rpc("request_verity_membership",{p_registration_code:b.registrationCode.trim().toUpperCase(),p_student_number:b.studentNumber||null});if(error)return s.status(400).json({error:error.message});s.status(201).json({membership:data});}));
app.get("/api/organization/my-membership",auth,roles("GRADUATE"),run(async(q,s)=>{const {data,error}=await q.supabase.from("Membership").select("id,status,studentNumber,createdAt,Organization:organizationId(name,type,status)").eq("userId",q.user.id).order("createdAt",{ascending:false});if(error)throw error;s.json({memberships:data||[]});}));
app.get("/api/organization",auth,roles("EMPLOYER"),run(async(q,s)=>{const {data,error}=await q.supabase.from("Organization").select("*").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;s.json({organization:data});}));

app.patch("/api/organization/identity",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const b=z.object({registrationNumber:z.string().max(100).optional(),officialWebsite:z.string().max(300).optional(),officialEmailDomain:z.string().max(150).optional(),accreditationBody:z.string().max(200).optional()}).parse(q.body);
 const {data:org,error:oe}=await q.supabase.from("Organization").select("id,type,status").eq("ownerId",q.user.id).maybeSingle();if(oe)throw oe;
 if(!org)return s.status(404).json({error:"Organization not found."});
 if(org.status!=="PENDING")return s.status(403).json({error:"Organization identity details can only be edited while the application is pending."});
 const patch={registrationNumber:b.registrationNumber?.trim()||null,officialWebsite:b.officialWebsite?.trim()||null,officialEmailDomain:b.officialEmailDomain?.trim().toLowerCase()||null,accreditationBody:b.accreditationBody?.trim()||null,updatedAt:new Date().toISOString()};
 if(org.type==="INSTITUTION"&&(!patch.registrationNumber||!patch.officialWebsite||!patch.accreditationBody))return s.status(400).json({error:"Institutions must provide a registration number, official website and accreditation body."});
 if(patch.officialWebsite&&!/^https?:\/\//i.test(patch.officialWebsite))return s.status(400).json({error:"Enter the official website with https:// or http://."});
 const {data,error}=await q.supabase.from("Organization").update(patch).eq("id",org.id).eq("ownerId",q.user.id).select("*").single();if(error)throw error;
 await audit(q.supabase,q.user.id,"ORGANIZATION_IDENTITY_UPDATED","Organization",org.id,{organizationId:org.id});
 s.json({organization:data});
}));

const staffPermissionArray=z.array(z.enum(STAFF_PERMISSIONS)).min(1).refine(isValidStaffPermissions,{message:"Only certificates:read and documents:download are supported; document downloads require certificate-read access."});
app.get("/api/organization/staff",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const {data:org,error}=await q.supabase.from("Organization").select("id,status").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;if(!org)return s.json({staff:[]});
 const {data,error:e}=await q.supabase.from("OrganizationStaff").select("id,userId,permissions,status,createdAt").eq("organizationId",org.id).order("createdAt",{ascending:false});if(e)throw e;
 const ids=(data||[]).map(x=>x.userId);const {data:users,error:ue}=ids.length?await q.supabase.from("User").select("id,fullName,email,role").in("id",ids):{data:[],error:null};if(ue)throw ue;
 s.json({staff:(data||[]).map(x=>({...x,user:(users||[]).find(u=>u.id===x.userId)||null})),organizationStatus:org.status});
}));
app.post("/api/organization/staff",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const b=z.object({email:z.string().email(),permissions:staffPermissionArray}).parse(q.body);
 const {data:org,error}=await q.supabase.from("Organization").select("id,status").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;if(!org||org.status!=="APPROVED")return s.status(403).json({error:"Only an approved organization can add staff."});
 const {data:person,error:pe}=await q.supabase.from("User").select("id,email,role").ilike("email",b.email.trim()).maybeSingle();if(pe)throw pe;if(!person)return s.status(404).json({error:"This person must create a Verity account before you can add them."});if(person.id===q.user.id)return s.status(400).json({error:"The organization owner is already an administrator."});if(person.role==="ADMIN"||person.role==="EMPLOYER")return s.status(400).json({error:"This account cannot be assigned as organization staff."});
 const {data,error:ie}=await q.supabase.from("OrganizationStaff").upsert({id:crypto.randomUUID(),organizationId:org.id,userId:person.id,permissions:b.permissions,status:"ACTIVE",createdBy:q.user.id,updatedAt:new Date().toISOString()},{onConflict:"organizationId,userId"}).select().single();if(ie)throw ie;
 await audit(q.supabase,q.user.id,"ORGANIZATION_STAFF_ADDED","OrganizationStaff",data.id,{organizationId:org.id,permissions:b.permissions});s.status(201).json({staff:data});
}));
app.patch("/api/organization/staff/:id",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const b=z.object({status:z.enum(["ACTIVE","SUSPENDED"]),permissions:staffPermissionArray.optional()}).parse(q.body);
 const {data:org,error}=await q.supabase.from("Organization").select("id,status").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;if(!org)return s.status(404).json({error:"Organization not found."});if(org.status!=="APPROVED")return s.status(403).json({error:"Only an approved organization can manage staff assignments."});
 const patch={status:b.status,updatedAt:new Date().toISOString()};if(b.permissions)patch.permissions=b.permissions;
 const {data,error:e}=await q.supabase.from("OrganizationStaff").update(patch).eq("id",q.params.id).eq("organizationId",org.id).select().single();if(e)throw e;
 await audit(q.supabase,q.user.id,"ORGANIZATION_STAFF_"+b.status,"OrganizationStaff",data.id,{organizationId:org.id,permissions:data.permissions});s.json({staff:data});
}));
app.get("/api/organization/members",auth,roles("EMPLOYER"),run(async(q,s)=>{const {data:org,error}=await q.supabase.from("Organization").select("id").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;if(!org)return s.json({members:[]});const {data,error:e}=await q.supabase.from("Membership").select("id,userId,studentNumber,status,createdAt").eq("organizationId",org.id).order("createdAt",{ascending:false});if(e)throw e;const ids=(data||[]).map(x=>x.userId);const {data:people,error:pe}=ids.length?await q.supabase.from("User").select("id,fullName,email,institution").in("id",ids):{data:[],error:null};if(pe)throw pe;s.json({members:(data||[]).map(m=>({...m,user:(people||[]).find(p=>p.id===m.userId)||null}))});}));
app.patch("/api/organization/members/:id",auth,roles("EMPLOYER"),run(async(q,s)=>{const b=z.object({status:z.enum(["ACTIVE","REJECTED"])}).parse(q.body);const {data:org,error}=await q.supabase.from("Organization").select("id,status,name,type").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;if(!org||org.status!=="APPROVED")return s.status(403).json({error:"Your organization must be approved first."});const {data:errorRow,error:e}=await q.supabase.from("Membership").select("id,userId,studentNumber").eq("id",q.params.id).eq("organizationId",org.id).single();if(e)throw e;const {data,error:updateError}=await q.supabase.from("Membership").update({status:b.status,updatedAt:new Date().toISOString()}).eq("id",q.params.id).eq("organizationId",org.id).select().single();if(updateError)throw updateError;if(b.status==="ACTIVE"){const {data:student}=await q.supabase.from("User").select("email").eq("id",errorRow.userId).maybeSingle();if(student?.email){const {error:certError}=await q.supabase.from("Certificate").update({graduateId:errorRow.userId,organizationId:org.id,updatedAt:new Date().toISOString()}).eq("studentEmail",student.email).eq("institution",org.name);if(certError)throw certError;}}await audit(q.supabase,q.user.id,"STUDENT_MEMBERSHIP_"+b.status,"Membership",data.id,{organizationId:org.id});s.json({membership:data});}));
app.post("/api/organization/evidence",auth,roles("EMPLOYER"),express.raw({type:["application/pdf","image/jpeg","image/png"],limit:"10mb"}),run(async(q,s)=>{
 const mime=q.headers["content-type"]?.split(";")[0]?.trim().toLowerCase(),spec=documentMime.get(mime),bytes=q.body;
 if(!spec||!Buffer.isBuffer(bytes)||!bytes.length||!spec.magic(bytes))return s.status(415).json({error:"Upload a valid PDF, JPEG or PNG evidence file."});
 if(bytes.length>10*1024*1024)return s.status(413).json({error:"Maximum evidence size is 10 MB."});
 const type=String(q.headers["x-evidence-type"]||"OTHER").toUpperCase();
 if(!["GOVERNMENT_REGISTRATION","ACCREDITATION","OFFICIAL_LETTER","OFFICIAL_WEBSITE","OTHER"].includes(type))return s.status(400).json({error:"Invalid evidence type."});
 const {data:org,error:oe}=await q.supabase.from("Organization").select("id,status").eq("ownerId",q.user.id).maybeSingle();if(oe)throw oe;
 if(!org||org.status!=="PENDING")return s.status(403).json({error:"Evidence can only be submitted while the organization application is pending."});
 const name=String(q.headers["x-file-name"]||("evidence."+spec.ext)).normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,120)||("evidence."+spec.ext);
 const id=crypto.randomUUID(),path=`${org.id}/${id}.${spec.ext}`,sha256=digest(bytes);
 const scanStatus="NOT_SCANNED";
 const {error:up}=await q.supabase.storage.from("verity-organization-evidence").upload(path,bytes,{contentType:mime,upsert:false});if(up)throw up;
 const {data:row,error}=await q.supabase.from("OrganizationEvidence").insert({id,organizationId:org.id,evidenceType:type,storagePath:path,originalName:name,mimeType:mime,sizeBytes:bytes.length,sha256,uploadedBy:q.user.id,scanStatus}).select("id,evidenceType,originalName,sizeBytes,sha256,scanStatus,createdAt").single();
 if(error){await q.supabase.storage.from("verity-organization-evidence").remove([path]);throw error;}
 await audit(q.supabase,q.user.id,"ORGANIZATION_EVIDENCE_UPLOADED","OrganizationEvidence",id,{organizationId:org.id,evidenceType:type,sha256,scanStatus});
 s.status(201).json({evidence:row,message:"Evidence uploaded and stored privately for administrator review."});
}));
app.get("/api/organization/evidence",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const {data:org,error:oe}=await q.supabase.from("Organization").select("id").eq("ownerId",q.user.id).maybeSingle();if(oe)throw oe;if(!org)return s.json({evidence:[]});
 const {data,error}=await q.supabase.from("OrganizationEvidence").select("id,evidenceType,originalName,sizeBytes,sha256,scanStatus,createdAt").eq("organizationId",org.id).order("createdAt",{ascending:false});if(error)throw error;s.json({evidence:data||[]});
}));
app.get("/api/admin/organizations/:id/evidence/:evidenceId",auth,roles("ADMIN"),run(async(q,s)=>{
 const {data:e,error}=await q.supabase.from("OrganizationEvidence").select("id,organizationId,storagePath,originalName,scanStatus").eq("id",q.params.evidenceId).eq("organizationId",q.params.id).maybeSingle();if(error)throw error;if(!e)return s.status(404).json({error:"Evidence not found."});
  const {data:link,error:le}=await q.supabase.storage.from("verity-organization-evidence").createSignedUrl(e.storagePath,60,{download:e.originalName});if(le)throw le;
 await audit(q.supabase,q.user.id,"ORGANIZATION_EVIDENCE_REVIEWED","OrganizationEvidence",e.id,{organizationId:e.organizationId});
 s.json({url:link.signedUrl,expiresIn:60,originalName:e.originalName});
}));
app.get("/api/admin/certificates/:id/document-preview",auth,roles("ADMIN"),run(async(q,res)=>{
  const {data:cert,error:ce}=await q.supabase.from("Certificate").select("id,certificateId,studentName,studentNumber,institution,department").eq("certificateId",q.params.id).maybeSingle();
  if(ce)throw ce;
  if(!cert)return res.status(404).json({error:"Certificate not found."});
  const {data:doc,error:de}=await q.supabase.from("CertificateDocument").select("id,storagePath,originalName,mimeType,sha256,scanStatus").eq("certificateId",cert.id).order("createdAt",{ascending:false}).limit(1).maybeSingle();
  if(de)throw de;
  if(!doc)return res.status(404).json({error:"The institution has not uploaded a certificate file for this record yet."});
  if(doc.scanStatus!=="CLEAN")return res.status(423).json({error:"This document is quarantined until ClamAV returns a CLEAN result.",scanStatus:doc.scanStatus});
  const {data:link,error:le}=await q.supabase.storage.from("verity-certificates").createSignedUrl(doc.storagePath,60);
  if(le)throw le;
  await audit(q.supabase,q.user.id,"ADMIN_CERTIFICATE_DOCUMENT_PREVIEWED","CertificateDocument",doc.id,{certificateId:cert.certificateId,scanStatus:doc.scanStatus});
  res.json({url:link.signedUrl,mimeType:doc.mimeType,originalName:doc.originalName,student:cert,expiresIn:60});
}));

app.get("/api/admin/organizations",auth,roles("ADMIN"),run(async(q,s)=>{const {data,error}=await q.supabase.from("Organization").select("*").order("createdAt",{ascending:false});if(error)throw error;const ids=(data||[]).map(o=>o.id);const {data:evidence,error:ee}=ids.length?await q.supabase.from("OrganizationEvidence").select("id,organizationId,evidenceType,originalName,scanStatus,createdAt").in("organizationId",ids).order("createdAt",{ascending:false}):{data:[],error:null};if(ee)throw ee;s.json({organizations:(data||[]).map(o=>({...o,evidence:(evidence||[]).filter(e=>e.organizationId===o.id)}))});}));
app.patch("/api/admin/organizations/:id",auth,roles("ADMIN"),run(async(q,s)=>{
 const b=z.object({status:z.enum(["APPROVED","SUSPENDED"]),verificationNotes:z.string().max(1000).optional()}).parse(q.body);
 const {data:org,error:oe}=await q.supabase.from("Organization").select("id,name,type,registrationNumber,officialWebsite,officialEmailDomain,accreditationBody").eq("id",q.params.id).maybeSingle();if(oe)throw oe;if(!org)return s.status(404).json({error:"Organization not found."});
 if(b.status==="APPROVED"){
   if(org.type==="INSTITUTION"&&(!org.registrationNumber||!org.officialWebsite||!org.accreditationBody))return s.status(400).json({error:"Institution approval requires its registration number, official website and accreditation body."});
   const {data:evidence,error:ee}=await q.supabase.from("OrganizationEvidence").select("id,evidenceType").eq("organizationId",org.id).limit(1);if(ee)throw ee;
   if(!evidence?.length)return s.status(400).json({error:"Review at least one official registration or accreditation evidence document before approval."});
 }
 const patch={status:b.status,updatedAt:new Date().toISOString(),verificationNotes:b.verificationNotes||null,verifiedAt:b.status==="APPROVED"?new Date().toISOString():null,verifiedBy:b.status==="APPROVED"?q.user.id:null};
 const {data,error}=await q.supabase.from("Organization").update(patch).eq("id",q.params.id).select().single();if(error)throw error;
 await audit(q.supabase,q.user.id,"ORGANIZATION_"+b.status,"Organization",data.id,{organizationId:data.id,verificationNotes:b.verificationNotes||null});
 s.json({organization:data});
}));

app.get("/api/dashboard",auth,run(async(q,s)=>{
  const admin=q.user.role==="ADMIN", graduate=q.user.role==="GRADUATE";
  const {data:ownedOrg,error:orgError}=q.user.role==="EMPLOYER"?await q.supabase.from("Organization").select("id,status,name,type,registrationCode").eq("ownerId",q.user.id).maybeSingle():{data:null,error:null};
  if(orgError)throw orgError;
  const base=()=>q.supabase.from("Certificate").select("id",{count:"exact",head:true});
  const scoped=()=>graduate?base().eq("graduateId",q.user.id):q.user.role==="EMPLOYER"?base().eq("organizationId",ownedOrg?.id||""):base();
  const recentQuery=()=>{let query=q.supabase.from("Certificate").select("certificateId,studentName,qualification,institution,issuedAt,status").order("issuedAt",{ascending:false}).limit(6);if(graduate)query=query.eq("graduateId",q.user.id);if(q.user.role==="EMPLOYER")query=query.eq("organizationId",ownedOrg?.id||"");return query;};
  const verificationQuery=()=>{let query=q.supabase.from("Verification").select("id",{count:"exact",head:true});if(q.user.role==="EMPLOYER")query=query.eq("organizationId",ownedOrg?.id||"");return query;};
  const [total,active,revoked,verifications,recent,recentChecks]=await Promise.all([
    scoped(),
    (graduate?base().eq("graduateId",q.user.id):q.user.role==="EMPLOYER"?base().eq("organizationId",ownedOrg?.id||""):base()).eq("status","ACTIVE"),
    (graduate?base().eq("graduateId",q.user.id):q.user.role==="EMPLOYER"?base().eq("organizationId",ownedOrg?.id||""):base()).eq("status","REVOKED"),
    admin||q.user.role==="EMPLOYER"?verificationQuery():Promise.resolve({count:0,error:null}),
    recentQuery(),
    admin?q.supabase.from("Verification").select("id,result,createdAt,certificateId").order("createdAt",{ascending:false}).limit(6):Promise.resolve({data:[],error:null})
  ]);
  for(const x of [total,active,revoked,verifications,recent,recentChecks]) if(x.error) throw x.error;
  s.json({stats:{total:total.count||0,active:active.count||0,revoked:revoked.count||0,verifications:verifications.count||0},recent:recent.data||[],recentChecks:recentChecks.data||[],organization:ownedOrg,blockchain:chainStatus(),generatedAt:new Date().toISOString()});
}));

app.get("/api/certificates",auth,run(async(q,s)=>{
  const staff=q.user.role==="GRADUATE"?await activeStaffFor(q.supabase,q.user.id):[];
  const readableStaffOrgs=staff.filter(x=>hasStaffPermission(x,"certificates:read"));
  if(!["ADMIN","GRADUATE","EMPLOYER"].includes(q.user.role)&&!readableStaffOrgs.length)return s.status(403).json({error:"Permission denied."});
  let query=q.supabase.from("Certificate").select("id,certificateId,verificationKey,studentName,studentNumber,institution,programme,qualification,classification,awardDate,issuedAt,digest,txHash,status,revokedAt,revokeReason,organizationId,graduateId").order("issuedAt",{ascending:false}).limit(100);
  if(q.user.role==="GRADUATE") query=readableStaffOrgs.length?query.or(`graduateId.eq.${q.user.id},organizationId.in.(${readableStaffOrgs.map(x=>x.organizationId).join(",")})`):query.eq("graduateId",q.user.id);
  if(q.user.role==="EMPLOYER"){const {data:org,error:oe}=await q.supabase.from("Organization").select("id").eq("ownerId",q.user.id).maybeSingle();if(oe)throw oe;query=query.eq("organizationId",org?.id||"");}
  const {data,error}=await query;
  if(error) throw error;
  s.json({certificates:data||[]});
}));

const issue=z.object({studentName:z.string().min(2),studentEmail:z.string().email().optional().or(z.literal("")),studentNumber:z.string().min(2),institution:z.string().min(2),faculty:z.string().min(2),department:z.string().min(2),programme:z.string().min(2),qualification:z.string().min(2),classification:z.string().optional(),awardDate:z.string().datetime()});
app.post("/api/certificates",auth,roles("EMPLOYER"),run(async(q,s)=>{
  const b=issue.parse(q.body); let organization=null;if(q.user.role==="EMPLOYER"){const {data,error}=await q.supabase.from("Organization").select("*").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;organization=data;if(!organization||organization.status!=="APPROVED")return s.status(403).json({error:"Your organization must be approved by the Verity System Admin before issuing certificates."});if(organization.type!=="INSTITUTION")return s.status(403).json({error:"Only approved academic institutions can issue academic certificates. Verification organizations cannot issue credentials."});}
  const certificateId=`VRT-${new Date().getFullYear()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const verificationKey=`VRT-${crypto.randomBytes(16).toString("hex").toUpperCase()}`;
  const clean=Object.fromEntries(Object.entries(b).map(([k,v])=>[k,typeof v==="string"?v.trim():v]));
  if(organization) clean.institution=organization.name;
  const hash=digest(canonical({...clean,certificateId}));
  const chain=await issueOnChain(certificateId,hash);
  let graduateId=null;
  if(clean.studentEmail){
    const {data:graduate,error:gError}=await q.supabase.from("User").select("id").eq("email",clean.studentEmail.toLowerCase()).maybeSingle();
    if(gError) throw gError;
    graduateId=graduate?.id||null;
  }
  const now=new Date().toISOString();
  const record={...clean,id:crypto.randomUUID(),studentEmail:clean.studentEmail||null,certificateId,verificationKey,organizationId:organization?.id||null,digest:hash,awardDate:new Date(clean.awardDate).toISOString(),issuerId:q.user.id,graduateId,txHash:chain.txHash,chainId:chain.chainId,contractAddress:chain.contractAddress,createdAt:now,updatedAt:now,issuedAt:now};
  const {data,error}=await q.supabase.from("Certificate").insert(record).select().single();
  if(error) throw error;
  await audit(q.supabase,q.user.id,"CERTIFICATE_ISSUED","Certificate",data.id,{certificateId,mode:chain.mode,organizationId:organization?.id||null});
  s.status(201).json({certificate:data,chainMode:chain.mode});
}));

app.get("/api/certificates/:id/qr",auth,run(async(q,s)=>{
  const {data:c,error}=await q.supabase.from("Certificate").select("id,certificateId,verificationKey,graduateId,organizationId").eq("certificateId",q.params.id).maybeSingle();
  if(error)throw error;
  if(!c)return s.status(404).json({error:"Certificate not found."});
  if(q.user.role==="EMPLOYER"){
    const {data:org,error:oe}=await q.supabase.from("Organization").select("id,status,type").eq("ownerId",q.user.id).maybeSingle();
    if(oe)throw oe;
    if(!org||org.id!==c.organizationId||org.status!=="APPROVED"||org.type!=="INSTITUTION")return s.status(403).json({error:"Only the approved issuing institution can generate its certificate QR."});
  }
  if(q.user.role==="GRADUATE"&&c.graduateId!==q.user.id){
    const staff=staffForOrganization(await activeStaffFor(q.supabase,q.user.id),c.organizationId);
    if(!hasStaffPermission(staff,"certificates:read"))return s.status(403).json({error:"Your active staff assignment does not allow certificate reading for this organization."});
  }
  const url=`${process.env.PUBLIC_APP_URL||q.protocol+"://"+q.get("host")}/verify/${encodeURIComponent(c.verificationKey)}`;
  s.json({url,key:c.verificationKey,certificateId:c.certificateId,dataUrl:await QRCode.toDataURL(url,{width:420,margin:2})});
}));

app.post("/api/certificates/:id/revoke",auth,roles("ADMIN","EMPLOYER"),run(async(q,s)=>{
  const b=z.object({reason:z.string().min(5).max(500)}).parse(q.body);
  const {data:c,error}=await q.supabase.from("Certificate").select("id,certificateId,status,organizationId").eq("certificateId",q.params.id).maybeSingle();
  if(error) throw error;
  if(!c) return s.status(404).json({error:"Certificate not found."});
  if(c.status==="REVOKED") return s.status(409).json({error:"Already revoked."});
  const chain=await revokeOnChain(c.certificateId,b.reason);
  const {data:updated,error:updateError}=await q.supabase.from("Certificate").update({status:"REVOKED",revokedAt:new Date().toISOString(),revokeReason:b.reason,updatedAt:new Date().toISOString()}).eq("id",c.id).select().single();
  if(updateError) throw updateError;
  await audit(q.supabase,q.user.id,"CERTIFICATE_REVOKED","Certificate",c.id,{reason:b.reason,mode:chain.mode,organizationId:c.organizationId||null});
  s.json({certificate:updated,chainMode:chain.mode});
}));


const documentMime = new Map([
  ["application/pdf",{ext:"pdf",magic:b=>b.subarray(0,5).toString("ascii")==="%PDF-"}],
  ["image/jpeg",{ext:"jpg",magic:b=>b.length>=3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff}],
  ["image/png",{ext:"png",magic:b=>b.length>=8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))}]
]);
app.post("/api/certificates/:id/document",auth,roles("EMPLOYER"),express.raw({type:["application/pdf","image/jpeg","image/png"],limit:"10mb"}),run(async(q,s)=>{
  const mime=q.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  const spec=documentMime.get(mime), bytes=q.body;
  if(!spec||!Buffer.isBuffer(bytes)||bytes.length===0)return s.status(400).json({error:"Upload a PDF, JPEG or PNG certificate file."});
  if(bytes.length>10*1024*1024)return s.status(413).json({error:"The maximum file size is 10 MB."});
  if(!spec.magic(bytes))return s.status(415).json({error:"The file content does not match its declared type."});
  const {data:org,error:orgError}=await q.supabase.from("Organization").select("id,status,type").eq("ownerId",q.user.id).maybeSingle();
  if(orgError)throw orgError;
  if(!org||org.status!=="APPROVED"||org.type!=="INSTITUTION")return s.status(403).json({error:"Only an approved academic institution can upload official certificate documents."});
  const {data:cert,error:certError}=await q.supabase.from("Certificate").select("id,certificateId,organizationId").eq("certificateId",q.params.id).eq("organizationId",org.id).maybeSingle();
  if(certError)throw certError;
  if(!cert)return s.status(404).json({error:"Certificate not found in your organization."});
  const safeName=String(q.headers["x-file-name"]||("certificate."+spec.ext)).normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,120)||("certificate."+spec.ext);
  const fileId=crypto.randomUUID(),storagePath=`${org.id}/${cert.id}/${fileId}.${spec.ext}`;
  const sha256=digest(bytes);
  const scan=await scanBuffer(bytes);
  const {error:uploadError}=await q.supabase.storage.from("verity-certificates").upload(storagePath,bytes,{contentType:mime,upsert:false,cacheControl:"3600"});
  if(uploadError)throw uploadError;
  const metadata={id:fileId,certificateId:cert.id,organizationId:org.id,storagePath,originalName:safeName,mimeType:mime,sizeBytes:bytes.length,sha256,uploadedBy:q.user.id,scanStatus:scan.status};
  const {data:doc,error:docError}=await q.supabase.from("CertificateDocument").insert(metadata).select("id,originalName,mimeType,sizeBytes,sha256,scanStatus,createdAt").single();
  if(docError){await q.supabase.storage.from("verity-certificates").remove([storagePath]);throw docError;}
  await audit(q.supabase,q.user.id,"CERTIFICATE_DOCUMENT_UPLOADED","CertificateDocument",doc.id,{certificateId:cert.certificateId,organizationId:org.id,sha256,scanStatus:scan.status,scannerConfigured:scan.scannerConfigured});
  const message=scan.status==="CLEAN"?"Document scanned by ClamAV and cleared for authorized access.":scan.status==="INFECTED"?"A malware signature was detected. The document is quarantined and cannot be opened.":"Document stored privately and quarantined until a successful malware scan is available.";
  s.status(201).json({document:doc,message,scan:{status:scan.status,scannerConfigured:scan.scannerConfigured}});
}));

app.get("/api/certificates/:id/documents",auth,roles("ADMIN","EMPLOYER","GRADUATE"),run(async(q,s)=>{
  const {data:cert,error:certError}=await q.supabase.from("Certificate").select("id,certificateId,organizationId,graduateId").eq("certificateId",q.params.id).maybeSingle();
  if(certError) throw certError;
  if(!cert) return s.status(404).json({error:"Certificate not found."});
  if(q.user.role==="EMPLOYER"){
    const {data:org,error}=await q.supabase.from("Organization").select("id").eq("ownerId",q.user.id).maybeSingle();
    if(error) throw error;if(!org||org.id!==cert.organizationId)return s.status(403).json({error:"Access denied."});
  }
  if(q.user.role==="GRADUATE"&&cert.graduateId!==q.user.id){
    const staff=staffForOrganization(await activeStaffFor(q.supabase,q.user.id),cert.organizationId);
    if(!hasStaffPermission(staff,"certificates:read"))return s.status(403).json({error:"Access denied."});
  }
  const {data,error}=await q.supabase.from("CertificateDocument").select("id,originalName,mimeType,sizeBytes,sha256,scanStatus,createdAt").eq("certificateId",cert.id).order("createdAt",{ascending:false});
  if(error) throw error;
  s.json({documents:data||[]});
}));
app.get("/api/certificate-documents/:id/download",auth,roles("ADMIN","EMPLOYER","GRADUATE"),run(async(q,s)=>{
  const {data:doc,error}=await q.supabase.from("CertificateDocument").select("id,storagePath,originalName,mimeType,certificateId,organizationId,scanStatus").eq("id",q.params.id).maybeSingle();
  if(error)throw error;
  if(!doc)return s.status(404).json({error:"Document not found."});
  if(q.user.role==="EMPLOYER"){
    const {data:org,error:oe}=await q.supabase.from("Organization").select("id,status").eq("ownerId",q.user.id).maybeSingle();
    if(oe)throw oe;
    if(!org||org.id!==doc.organizationId||org.status!=="APPROVED")return s.status(403).json({error:"Access denied."});
  }
  let staffDownload=false;
  if(q.user.role==="GRADUATE"){
    const {data:c,error:ce}=await q.supabase.from("Certificate").select("graduateId").eq("id",doc.certificateId).maybeSingle();
    if(ce)throw ce;
    if(c?.graduateId!==q.user.id){
      const staff=staffForOrganization(await activeStaffFor(q.supabase,q.user.id),doc.organizationId);
      if(!hasStaffPermission(staff,"documents:download"))return s.status(403).json({error:"Your active staff assignment does not allow document downloads for this organization."});
      staffDownload=true;
    }
  }
  if(doc.scanStatus!=="CLEAN")return s.status(423).json({error:"This document is quarantined and cannot be downloaded until ClamAV returns a CLEAN result.",scanStatus:doc.scanStatus});
  const {data:file,error:fileError}=await q.supabase.storage.from("verity-certificates").download(doc.storagePath);
  if(fileError)throw fileError;
  const bytes=Buffer.from(await file.arrayBuffer());
  const safeName=(doc.originalName||"VERITY-CERTIFICATE").normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,120);
  await audit(q.supabase,q.user.id,"CERTIFICATE_DOCUMENT_DOWNLOADED","CertificateDocument",doc.id,{organizationId:doc.organizationId,scanStatus:doc.scanStatus,staffDownload});
  s.setHeader("Content-Type",doc.mimeType);
  s.setHeader("Content-Disposition",`attachment; filename="${safeName}"`);
  s.setHeader("Content-Length",String(bytes.length));
  s.setHeader("Cache-Control","private, no-store");
  s.setHeader("X-Content-Type-Options","nosniff");
  s.send(bytes);
}));

app.post("/api/institution/verify",auth,roles("EMPLOYER"),run(async(q,s)=>{
  const b=z.object({certificateId:z.string().min(4).max(200)}).parse(q.body);
  const {data:org,error:orgError}=await q.supabase.from("Organization").select("id,name,type,status").eq("ownerId",q.user.id).maybeSingle();
  if(orgError)throw orgError;
  if(!org||org.type!=="INSTITUTION"||org.status!=="APPROVED")return s.status(403).json({error:"Only an approved academic institution can verify its own issued certificates."});
  const reference=b.certificateId.trim();
  let query=q.supabase.from("Certificate").select("id,certificateId,verificationKey,studentName,studentNumber,institution,faculty,department,programme,qualification,classification,awardDate,issuedAt,digest,txHash,status,organizationId").eq("organizationId",org.id);
  let {data:c,error}=await query.eq("certificateId",reference).maybeSingle();
  if(error)throw error;
  if(!c){const result=await q.supabase.from("Certificate").select("id,certificateId,verificationKey,studentName,studentNumber,institution,faculty,department,programme,qualification,classification,awardDate,issuedAt,digest,txHash,status,organizationId").eq("organizationId",org.id).eq("verificationKey",reference.toUpperCase()).maybeSingle();c=result.data;error=result.error;if(error)throw error;}
  if(!c)return s.status(404).json({verified:false,status:"NOT_FOUND",message:"This certificate reference was not found in your institution's own issuance records."});
  const recomputed=org.type==="INSTITUTION"?digest(canonical(c)):null,dbOk=org.type!=="INSTITUTION"||recomputed===c.digest,chain=await verifyOnChain(c.certificateId);
  const chainOk=!chain.enabled||(chain.exists===true&&chain.digest?.toLowerCase()===String(c.digest||"").toLowerCase()&&!chain.revoked);
  const verified=c.status==="ACTIVE"&&dbOk&&chainOk;
  const status=c.status==="REVOKED"||chain.revoked?"REVOKED":verified?"VERIFIED":"INTEGRITY_MISMATCH";
  await audit(q.supabase,q.user.id,"INSTITUTION_CERTIFICATE_VERIFIED","Certificate",c.id,{certificateId:c.certificateId,organizationId:org.id,status});
  s.json({verified,status,message:verified?"This certificate matches the academic record issued by your institution.":status==="REVOKED"?"Your institution has revoked this certificate.":"The certificate record's integrity check did not match.",certificate:{certificateId:c.certificateId,verificationKey:c.verificationKey,studentName:c.studentName,institution:c.institution,qualification:c.qualification,awardDate:c.awardDate,issuedAt:c.issuedAt,digest:c.digest,txHash:c.txHash,status:c.status},verifierOrganization:org.name,chain:chain.enabled?{enabled:true,exists:chain.exists,network:"Polygon Amoy",chainId:chain.chainId,contractAddress:chain.contractAddress}:{enabled:false,note:"Demo database ledger; on-chain verification is not active."}});
}));

app.post("/api/institution/verify",auth,roles("EMPLOYER"),run(async(q,s)=>{
  const b=z.object({certificateId:z.string().min(4).max(200)}).parse(q.body);
  const {data:org,error:orgError}=await q.supabase.from("Organization").select("id,name,type,status").eq("ownerId",q.user.id).maybeSingle();
  if(orgError)throw orgError;
  if(!org||org.type!=="INSTITUTION"||org.status!=="APPROVED")return s.status(403).json({error:"Only an approved academic institution can verify its own issued certificates."});
  const reference=b.certificateId.trim();
  const fields="id,certificateId,verificationKey,studentName,studentNumber,institution,faculty,department,programme,qualification,classification,awardDate,issuedAt,digest,txHash,status,organizationId";
  let {data:c,error}=await q.supabase.from("Certificate").select(fields).eq("organizationId",org.id).eq("certificateId",reference).maybeSingle();
  if(error)throw error;
  if(!c){const result=await q.supabase.from("Certificate").select(fields).eq("organizationId",org.id).eq("verificationKey",reference.toUpperCase()).maybeSingle();c=result.data;error=result.error;if(error)throw error;}
  if(!c)return s.status(404).json({verified:false,status:"NOT_FOUND",message:"This certificate reference was not found in your institution's own issuance records."});
  const recomputed=digest(canonical(c)),dbOk=recomputed===c.digest,chain=await verifyOnChain(c.certificateId);
  const chainOk=!chain.enabled||(chain.exists===true&&chain.digest?.toLowerCase()===recomputed.toLowerCase()&&!chain.revoked);
  const verified=c.status==="ACTIVE"&&dbOk&&chainOk;
  const status=c.status==="REVOKED"||chain.revoked?"REVOKED":verified?"VERIFIED":"INTEGRITY_MISMATCH";
  await audit(q.supabase,q.user.id,"INSTITUTION_CERTIFICATE_VERIFIED","Certificate",c.id,{certificateId:c.certificateId,organizationId:org.id,status});
  s.json({verified,status,message:verified?"This certificate matches the academic record issued by your institution.":status==="REVOKED"?"Your institution has revoked this certificate.":"The certificate record's integrity check did not match.",certificate:{certificateId:c.certificateId,verificationKey:c.verificationKey,studentName:c.studentName,institution:c.institution,qualification:c.qualification,awardDate:c.awardDate,issuedAt:c.issuedAt,digest:c.digest,txHash:c.txHash,status:c.status},verifierOrganization:org.name,chain:chain.enabled?{enabled:true,exists:chain.exists,network:"Polygon Amoy",chainId:chain.chainId,contractAddress:chain.contractAddress}:{enabled:false,note:"Demo database ledger; on-chain verification is not active."}});
}));

app.post("/api/organization/verify",auth,roles("EMPLOYER"),run(async(q,s)=>{
  const b=z.object({certificateId:z.string().min(4)}).parse(q.body);
  const {data:org,error:orgError}=await q.supabase.from("Organization").select("id,name,type,status").eq("ownerId",q.user.id).maybeSingle();
  if(orgError)throw orgError;
  if(!org||org.type!=="EMPLOYER"||org.status!=="APPROVED")return s.status(403).json({error:"Only an approved verification organization can verify credentials through its workspace."});
  const {data,error}=await q.supabase.rpc("lookup_verity_certificate_for_org",{p_certificate_id:b.certificateId.trim()});
  if(error)throw error;
  if(!data?.found)return s.status(404).json({verified:false,status:"NOT_FOUND",message:"No credential with this ID or verification key exists in the Verity registry."});
  const c=data,recomputed=digest(canonical(c)),dbOk=recomputed===c.digest,chain=await verifyOnChain(c.certificateId);
  const chainOk=!chain.enabled||(chain.exists===true&&chain.digest?.toLowerCase()===recomputed.toLowerCase()&&!chain.revoked);
  const verified=c.status==="ACTIVE"&&dbOk&&chainOk;
  const status=c.status==="REVOKED"||chain.revoked?"REVOKED":verified?"VERIFIED":"INTEGRITY_MISMATCH";
  s.json({verified,status,message:verified?"Credential matches the issuing institution's registered record.":status==="REVOKED"?"The issuing institution has revoked this credential.":"The registered fingerprint does not match.",certificate:{certificateId:c.certificateId,verificationKey:c.verificationKey,studentName:c.studentName,institution:c.institution,faculty:c.faculty,department:c.department,programme:c.programme,qualification:c.qualification,classification:c.classification,awardDate:c.awardDate,issuedAt:c.issuedAt,digest:c.digest,txHash:c.txHash,status:c.status},verifierOrganization:org.name,chain:chain.enabled?{enabled:true,exists:chain.exists,network:"Polygon Amoy",chainId:chain.chainId,contractAddress:chain.contractAddress}:{enabled:false,note:"Demo database ledger; on-chain verification is not active."}});
}));

app.post("/api/organization/student-lookup",auth,roles("EMPLOYER"),run(async(q,res)=>{
  const b=z.object({studentName:z.string().min(2).max(120),studentNumber:z.string().min(2).max(80),institution:z.string().min(2).max(160),department:z.string().min(2).max(160)}).parse(q.body);
  const {data:org,error:oe}=await q.supabase.from("Organization").select("id,type,status").eq("ownerId",q.user.id).maybeSingle();
  if(oe)throw oe;
  if(!org||org.type!=="EMPLOYER"||org.status!=="APPROVED")return res.status(403).json({error:"Only an approved verification organization can search student records."});
  const {data,error}=await q.supabase.from("Certificate").select("certificateId,studentName,studentNumber,institution,department,status,graduateId").eq("studentNumber",b.studentNumber.trim()).eq("studentName",b.studentName.trim()).eq("institution",b.institution.trim()).eq("department",b.department.trim()).limit(5);
  if(error)throw error;
  const matches=(data||[]).map(c=>({certificateId:c.certificateId,studentName:c.studentName,studentNumber:c.studentNumber,institution:c.institution,department:c.department,status:c.status,requestable:!!c.graduateId}));
  await audit(q.supabase,q.user.id,"ORGANIZATION_STUDENT_LOOKUP","Certificate",null,{organizationId:org.id,matchCount:matches.length});
  res.json({matches});
}));

app.post("/api/organization/access-requests",auth,roles("EMPLOYER"),run(async(q,s)=>{
  const b=z.object({certificateId:z.string().min(4),purpose:z.string().min(5).max(300).optional()}).parse(q.body);
  const {data:org,error:oe}=await q.supabase.from("Organization").select("id,name,type,status").eq("ownerId",q.user.id).maybeSingle();
  if(oe)throw oe;if(!org||org.type!=="EMPLOYER"||org.status!=="APPROVED")return s.status(403).json({error:"Only an approved verification organization can request certificate access."});
  const {data:cert,error:ce}=await q.supabase.from("Certificate").select("id,certificateId,graduateId").or("certificateId.eq."+b.certificateId+",verificationKey.eq."+b.certificateId.toUpperCase()).maybeSingle();
  if(ce)throw ce;if(!cert)return s.status(404).json({error:"Certificate not found."});
  if(!cert.graduateId)return s.status(409).json({error:"The graduate must link their Verity account to this certificate before private document access can be requested."});
  const {data:existing,error:ee}=await q.supabase.from("CertificateAccessGrant").select("id,status").eq("certificateId",cert.id).eq("organizationId",org.id).maybeSingle();
  if(ee)throw ee;
  if(existing)return s.status(200).json({grant:existing,message:"An access request or decision already exists for this organization and certificate."});
  const {data:grant,error}=await q.supabase.from("CertificateAccessGrant").insert({id:crypto.randomUUID(),certificateId:cert.id,graduateId:cert.graduateId,organizationId:org.id,requestedBy:q.user.id,purpose:b.purpose||"Employment or academic credential verification",status:"PENDING"}).select().single();
  if(error)throw error;
  await audit(q.supabase,q.user.id,"CERTIFICATE_ACCESS_REQUESTED","CertificateAccessGrant",grant.id,{certificateId:cert.certificateId,organizationId:org.id});
  s.status(201).json({grant,message:"The graduate must approve access before the original document can be viewed."});
}));

app.get("/api/organization/access-requests",auth,roles("EMPLOYER"),run(async(q,s)=>{
  const {data:org,error:oe}=await q.supabase.from("Organization").select("id,type,status").eq("ownerId",q.user.id).maybeSingle();
  if(oe)throw oe;if(!org||org.type!=="EMPLOYER"||org.status!=="APPROVED")return s.status(403).json({error:"Only an approved verification organization can view its access requests."});
  const {data,error}=await q.supabase.from("CertificateAccessGrant").select("id,certificateId,graduateId,purpose,status,createdAt,approvedAt,expiresAt").eq("organizationId",org.id).order("createdAt",{ascending:false});
  if(error)throw error;
  const ids=(data||[]).map(x=>x.certificateId);
  const {data:certs,error:ce}=ids.length?await q.supabase.from("Certificate").select("id,certificateId,studentName,institution,qualification").in("id",ids):{data:[],error:null};
  if(ce)throw ce;
  s.json({requests:(data||[]).map(x=>({...x,certificate:(certs||[]).find(c=>c.id===x.certificateId)||null}))});
}));

app.get("/api/graduate/access-requests",auth,roles("GRADUATE"),run(async(q,s)=>{
  const {data,error}=await q.supabase.from("CertificateAccessGrant").select("id,certificateId,organizationId,purpose,status,createdAt,approvedAt,expiresAt,Organization:organizationId(name,type)").eq("graduateId",q.user.id).order("createdAt",{ascending:false});
  if(error)throw error;
  const ids=(data||[]).map(x=>x.certificateId);
  const {data:certs,error:ce}=ids.length?await q.supabase.from("Certificate").select("id,certificateId,studentName,institution,qualification").in("id",ids):{data:[],error:null};
  if(ce)throw ce;
  s.json({requests:(data||[]).map(x=>({...x,certificate:(certs||[]).find(c=>c.id===x.certificateId)||null}))});
}));

app.patch("/api/graduate/access-requests/:id",auth,roles("GRADUATE"),run(async(q,s)=>{
  const b=z.object({status:z.enum(["APPROVED","REJECTED"])}).parse(q.body);
  const now=new Date().toISOString();
  const patch={status:b.status,updatedAt:now,approvedAt:b.status==="APPROVED"?now:null,expiresAt:b.status==="APPROVED"?new Date(Date.now()+30*24*60*60*1000).toISOString():null};
  const {data,error}=await q.supabase.from("CertificateAccessGrant").update(patch).eq("id",q.params.id).eq("graduateId",q.user.id).eq("status","PENDING").select().single();
  if(error)throw error;
  await audit(q.supabase,q.user.id,"CERTIFICATE_ACCESS_"+b.status,"CertificateAccessGrant",data.id,{organizationId:data.organizationId,expiresAt:data.expiresAt});
  s.json({grant:data});
}));

app.get("/api/organization/access-requests/:id/document",auth,roles("EMPLOYER"),run(async(q,s)=>{
  const {data:org,error:oe}=await q.supabase.from("Organization").select("id,type,status").eq("ownerId",q.user.id).maybeSingle();
  if(oe)throw oe;
  if(!org||org.type!=="EMPLOYER"||org.status!=="APPROVED")return s.status(403).json({error:"Only an approved verification organization can access shared documents."});
  const {data:grant,error:ge}=await q.supabase.from("CertificateAccessGrant").select("id,certificateId,status,expiresAt").eq("id",q.params.id).eq("organizationId",org.id).maybeSingle();
  if(ge)throw ge;
  if(!grant||grant.status!=="APPROVED"||(grant.expiresAt&&new Date(grant.expiresAt)<=new Date()))return s.status(403).json({error:"The graduate has not approved access, or the approval has expired."});
  const {data:doc,error:de}=await q.supabase.from("CertificateDocument").select("id,storagePath,originalName,mimeType,scanStatus").eq("certificateId",grant.certificateId).order("createdAt",{ascending:false}).limit(1).maybeSingle();
  if(de)throw de;
  if(!doc)return s.status(404).json({error:"The institution has not uploaded an original certificate document yet."});
  if(doc.scanStatus!=="CLEAN")return s.status(423).json({error:"This document is quarantined until ClamAV returns a CLEAN result.",scanStatus:doc.scanStatus});
  const {data:link,error:le}=await q.supabase.storage.from("verity-certificates").createSignedUrl(doc.storagePath,60);
  if(le)throw le;
  await audit(q.supabase,q.user.id,"SHARED_CERTIFICATE_DOCUMENT_VIEWED","CertificateDocument",doc.id,{organizationId:org.id,grantId:grant.id,scanStatus:doc.scanStatus});
  s.json({url:link.signedUrl,expiresIn:60,originalName:doc.originalName,mimeType:doc.mimeType});
}));

app.get("/api/organization/access-requests/:id/document/download",auth,roles("EMPLOYER"),run(async(q,s)=>{
  const {data:org,error:oe}=await q.supabase.from("Organization").select("id,name,type,status").eq("ownerId",q.user.id).maybeSingle();
  if(oe)throw oe;
  if(!org||org.type!=="EMPLOYER"||org.status!=="APPROVED")return s.status(403).json({error:"Only an approved verification organization can download shared documents."});
  const {data:grant,error:ge}=await q.supabase.from("CertificateAccessGrant").select("id,certificateId,status,expiresAt").eq("id",q.params.id).eq("organizationId",org.id).maybeSingle();
  if(ge)throw ge;
  if(!grant||grant.status!=="APPROVED"||(grant.expiresAt&&new Date(grant.expiresAt)<=new Date()))return s.status(403).json({error:"The graduate has not approved access, or the approval has expired."});
  const {data:doc,error:de}=await q.supabase.from("CertificateDocument").select("id,storagePath,originalName,mimeType,scanStatus").eq("certificateId",grant.certificateId).order("createdAt",{ascending:false}).limit(1).maybeSingle();
  if(de)throw de;
  if(!doc)return s.status(404).json({error:"The institution has not uploaded an original certificate document yet."});
  if(doc.scanStatus!=="CLEAN")return s.status(423).json({error:"This document is quarantined until ClamAV returns a CLEAN result.",scanStatus:doc.scanStatus});
  const {data:file,error:fe}=await q.supabase.storage.from("verity-certificates").download(doc.storagePath);
  if(fe)throw fe;
  const source=Buffer.from(await file.arrayBuffer());
  const {PDFDocument,StandardFonts,rgb,degrees}=await import("pdf-lib");
  const pdf=doc.mimeType==="application/pdf"?await PDFDocument.load(source):await PDFDocument.create();
  if(doc.mimeType==="image/png"||doc.mimeType==="image/jpeg"){
    const image=doc.mimeType==="image/png"?await pdf.embedPng(source):await pdf.embedJpg(source);
    const scale=Math.min(842/image.width,595/image.height,1);
    const page=pdf.addPage([image.width*scale,image.height*scale]);
    page.drawImage(image,{x:0,y:0,width:image.width*scale,height:image.height*scale});
  }else if(doc.mimeType!=="application/pdf"){
    return s.status(415).json({error:"Only PDF, JPEG and PNG certificates can be watermarked for organization download."});
  }
  const font=await pdf.embedFont(StandardFonts.HelveticaBold);
  for(const page of pdf.getPages()){
    const {width,height}=page.getSize();
    const size=Math.max(20,Math.min(34,width/18));
    for(let y=-height;y<height*2;y+=Math.max(125,height/3)){
      for(let x=-width;x<width*2;x+=Math.max(180,width/2)){
        page.drawText("VERITY · AUTHORIZED COPY",{x,y,size,font,color:rgb(0.05,0.30,0.34),opacity:0.19,rotate:degrees(-32)});
      }
    }
    page.drawRectangle({x:0,y:0,width,height:26,color:rgb(0.04,0.15,0.22),opacity:0.88});
    page.drawText("VERITY  |  VERIFIED DOCUMENT COPY  |  "+doc.originalName.slice(0,90),{x:12,y:8,size:9,font,color:rgb(1,1,1),maxWidth:width-24});
  }
  const output=Buffer.from(await pdf.save());
  const safeName=(doc.originalName||"certificate").replace(/[^a-zA-Z0-9._-]/g,"_").replace(/\.(pdf|png|jpe?g)$/i,"");
  await audit(q.supabase,q.user.id,"SHARED_CERTIFICATE_DOCUMENT_DOWNLOADED","CertificateDocument",doc.id,{organizationId:org.id,grantId:grant.id,watermarked:true,scanStatus:doc.scanStatus});
  s.setHeader("Content-Type","application/pdf");
  s.setHeader("Content-Disposition",`attachment; filename="${safeName}-VERITY-WATERMARKED.pdf"`);
  s.setHeader("Cache-Control","private, no-store");
  s.send(output);
}));

app.post("/api/verify",run(async(q,s)=>{
  const b=z.object({certificateId:z.string().min(4),verifierName:z.string().optional(),verifierOrg:z.string().optional()}).parse(q.body);
  const client=makeClient();
  const {data,error}=await client.rpc("lookup_verity_certificate",{p_certificate_id:b.certificateId.trim(),p_verifier_name:b.verifierName||null,p_verifier_org:b.verifierOrg||null});
  if(error) throw error;
  if(!data?.found) return s.status(404).json({verified:false,status:"NOT_FOUND",message:"No credential with this ID exists in the registry."});
  const c=data,chain=await verifyOnChain(c.certificateId);
  const chainOk=!chain.enabled||(chain.exists===true&&chain.digest?.toLowerCase()===String(c.digest||"").toLowerCase()&&!chain.revoked);
  const verified=c.status==="ACTIVE"&&chainOk;
  const status=c.status==="REVOKED"||chain.revoked?"REVOKED":verified?"VERIFIED":"INTEGRITY_MISMATCH";
  s.json({verified,status,message:verified?(chain.enabled?"Credential record and blockchain fingerprint match.":"Credential is registered in the issuing institution's Verity record; public-chain integrity checking is not active.") :status==="REVOKED"?"This credential has been revoked by its issuing institution.":"The blockchain fingerprint does not match the registered record.",integrity:chain.enabled?"BLOCKCHAIN_FINGERPRINT_MATCH":"DATABASE_LEDGER_ONLY",certificate:{certificateId:c.certificateId,verificationKey:c.verificationKey,studentName:c.studentName,institution:c.institution,qualification:c.qualification,awardDate:c.awardDate,issuedAt:c.issuedAt,digest:c.digest,txHash:c.txHash,status:c.status},chain:chain.enabled?{enabled:true,exists:chain.exists,network:"Polygon Amoy",chainId:chain.chainId,contractAddress:chain.contractAddress,issuer:chain.issuer,issuedAt:chain.issuedAt}:{enabled:false,note:"Demo database ledger; configure Polygon Amoy RPC, project signer and deployed contract for on-chain verification."}});
}));

app.get("/api/admin/showcase-video",auth,roles("ADMIN"),run(async(q,s)=>{
  const count=()=>q.supabase.from("Certificate").select("id",{count:"exact",head:true});
  const [total,active,revoked,verifications,latestCertificate,auditResult]=await Promise.all([
    count(),
    count().eq("status","ACTIVE"),
    count().eq("status","REVOKED"),
    q.supabase.from("Verification").select("id",{count:"exact",head:true}),
    q.supabase.from("Certificate").select("certificateId,verificationKey,studentName,studentNumber,institution,faculty,department,programme,qualification,classification,awardDate,issuedAt,digest,txHash,status,graduateId").eq("status","ACTIVE").order("issuedAt",{ascending:false}).limit(1).maybeSingle(),
    q.supabase.from("AuditEvent").select("action,entity,createdAt,metadata").order("createdAt",{ascending:false}).limit(5)
  ]);
  for(const result of [total,active,revoked,verifications,latestCertificate,auditResult]) if(result.error) throw result.error;

  const certificate=latestCertificate.data||null;
  let verification=null;
  if(certificate?.verificationKey){
    try{
      const {data:record,error}=await q.supabase.rpc("lookup_verity_certificate",{p_certificate_id:certificate.verificationKey,p_verifier_name:null,p_verifier_org:null});
      if(error) throw error;
      if(!record?.found){
        verification={verified:false,status:"NOT_FOUND",message:"The live registry did not return this credential."};
      }else{
        const chain=await verifyOnChain(record.certificateId);
        const chainOk=!chain.enabled||(chain.exists===true&&chain.digest?.toLowerCase()===String(record.digest||"").toLowerCase()&&!chain.revoked);
        const verified=record.status==="ACTIVE"&&chainOk;
        verification={verified,status:record.status==="REVOKED"||chain.revoked?"REVOKED":verified?"VERIFIED":"INTEGRITY_MISMATCH"};
      }
    }catch(error){
      verification={verified:false,status:"LIVE CHECK UNAVAILABLE",message:error.message};
    }
  }else{
    verification={verified:false,status:"NO ACTIVE CREDENTIAL",message:"Issue an active credential to demonstrate a live registry check."};
  }

  const video=await createVerityMarketingMp4({
    stats:{total:total.count||0,active:active.count||0,revoked:revoked.count||0,verifications:verifications.count||0},
    certificate,
    auditEvents:auditResult.data||[],
    chain:chainStatus(),
    verification
  });
  await audit(q.supabase,q.user.id,"ADMIN_MARKETING_VIDEO_DOWNLOADED","Platform",null,{format:"mp4",durationSeconds:90,source:"live-dashboard-and-credential-record",verificationStatus:verification?.status||"UNAVAILABLE"});
  s.setHeader("Content-Type","video/mp4");
  s.setHeader("Content-Disposition",'attachment; filename="VERITY-Marketing-Showcase.mp4"');
  s.setHeader("Content-Length",video.length);
  s.setHeader("Cache-Control","private, no-store");
  s.send(video);
}));

app.get("/api/audit",auth,roles("ADMIN"),run(async(q,s)=>{
  const {data,error}=await q.supabase.from("AuditEvent").select("id,action,entity,entityId,metadata,createdAt,actor:User!AuditEvent_actorId_fkey(fullName,email)").order("createdAt",{ascending:false}).limit(100);
  if(error) throw error;
  s.json({events:data||[]});
}));

app.use("/api",(q,s)=>s.status(404).json({error:"API route not found."}));
app.use((e,q,s,_n)=>{if(e instanceof z.ZodError)return s.status(400).json({error:"Please check the form fields.",details:e.issues});console.error(e);s.status(500).json({error:e.message||"Unexpected server error."});});
app.use(express.static(path.resolve(root,"../dist")));
app.get("*",(_q,s)=>s.sendFile(path.resolve(root,"../dist/index.html")));
async function start(){
  if(!configured) throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required.");
  const chain=await connectChain();
  console.log("Supabase Auth and Data API configured.");
  console.log("Blockchain:",chain.enabled?"connected":"demo database ledger");
  console.log("Certificate malware scanning:",process.env.CLAMAV_HOST?.trim()?"ClamAV host configured; upload verdicts are still required before access.":"ClamAV not configured; certificate uploads remain PENDING_SCAN.");
  app.listen(PORT,"0.0.0.0",()=>console.log(`Verity listening on ${PORT}`));
}
start().catch(e=>{console.error(e);process.exit(1);});