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
import { connectChain, chainStatus, issueOnChain, revokeOnChain, verifyOnChain } from "./chain.js";

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
const CLAMAV_HOST=process.env.CLAMAV_HOST||"";
const CLAMAV_PORT=Number(process.env.CLAMAV_PORT||3310);
const CLAMAV_TIMEOUT_MS=Math.min(Math.max(Number(process.env.CLAMAV_TIMEOUT_MS||60000),5000),120000);
async function scanWithClamAV(bytes) {
  if(!CLAMAV_HOST) throw new Error("ClamAV scanner is not configured (CLAMAV_HOST is missing).");
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection({host:CLAMAV_HOST,port:CLAMAV_PORT});
    let response="",settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(result);};
    const timer=setTimeout(()=>finish(new Error("ClamAV scan timed out.")),CLAMAV_TIMEOUT_MS);
    socket.on("connect",()=>{
      socket.write("zINSTREAM\0");
      const chunkSize=64*1024;
      for(let offset=0;offset<bytes.length;offset+=chunkSize){
        const chunk=bytes.subarray(offset,Math.min(offset+chunkSize,bytes.length));
        const header=Buffer.alloc(4);header.writeUInt32BE(chunk.length);
        socket.write(header);socket.write(chunk);
      }
      const end=Buffer.alloc(4);end.writeUInt32BE(0);socket.write(end);
    });
    socket.on("data",data=>{
      response+=data.toString("utf8");
      if(response.includes("\0")||/\b(?:OK|FOUND|ERROR)\s*$/.test(response.trim())){
        if(/: OK(?:\0|$)/.test(response.trim()))finish(null,{status:"CLEAN",detail:response.trim()});
        else if(/: .+ FOUND(?:\0|$)/.test(response.trim()))finish(null,{status:"INFECTED",detail:response.trim()});
        else finish(new Error("ClamAV returned an unrecognized response."));
      }
    });
    socket.on("error",error=>finish(new Error("ClamAV connection failed: "+error.message)));
    socket.on("end",()=>{if(!settled)finish(new Error("ClamAV closed the connection before returning a verdict."));});
  });
}
async function scanUpload(bytes,entityLabel) {
  try { return await scanWithClamAV(bytes); }
  catch(error) {
    const detail=error.message||"ClamAV scan failed.";
    console.error(entityLabel+" scan failed:",detail);
    return {status:"SCAN_FAILED",detail};
  }
}

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
 const {data,error}=await client.from("OrganizationStaff").select("id,organizationId,permissions,status").eq("userId",userId).eq("status","ACTIVE");
 if(error) throw error;
 return data||[];
}
const staffForOrganization=(staff,organizationId)=>staff.find(x=>x.organizationId===organizationId)||null;
const hasStaffPermission=(staff,permission)=>Boolean(staff&&staff.status==="ACTIVE"&&staff.permissions?.includes(permission));
async function audit(client,actorId,action,entity,entityId,metadata={}) {
  const {error}=await client.from("AuditEvent").insert({id:crypto.randomUUID(),actorId,action,entity,entityId,metadata,createdAt:new Date().toISOString()});
  if(error) throw error;
}

app.get("/api/health",(_q,s)=>s.json({status:"ok",database:configured?"supabase_data_api_configured":"not_configured",blockchain:chainStatus()}));

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

const staffPermissions=["certificates:read","documents:download"];
app.get("/api/organization/staff",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const {data:org,error}=await q.supabase.from("Organization").select("id,status").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;if(!org)return s.json({staff:[]});
 const {data,error:e}=await q.supabase.from("OrganizationStaff").select("id,userId,permissions,status,createdAt").eq("organizationId",org.id).order("createdAt",{ascending:false});if(e)throw e;
 const ids=(data||[]).map(x=>x.userId);const {data:users,error:ue}=ids.length?await q.supabase.from("User").select("id,fullName,email,role").in("id",ids):{data:[],error:null};if(ue)throw ue;
 s.json({staff:(data||[]).map(x=>({...x,user:(users||[]).find(u=>u.id===x.userId)||null})),organizationStatus:org.status});
}));
app.post("/api/organization/staff",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const b=z.object({email:z.string().email(),permissions:z.array(z.enum(staffPermissions)).min(1)}).parse(q.body);
 const {data:org,error}=await q.supabase.from("Organization").select("id,status").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;if(!org||org.status!=="APPROVED")return s.status(403).json({error:"Only an approved organization can add staff."});
 const {data:person,error:pe}=await q.supabase.from("User").select("id,email,role").ilike("email",b.email.trim()).maybeSingle();if(pe)throw pe;if(!person)return s.status(404).json({error:"This person must create a Verity account before you can add them."});if(person.id===q.user.id)return s.status(400).json({error:"The organization owner is already an administrator."});if(person.role==="ADMIN"||person.role==="EMPLOYER")return s.status(400).json({error:"This account cannot be assigned as organization staff."});
 const {data,error:ie}=await q.supabase.from("OrganizationStaff").upsert({id:crypto.randomUUID(),organizationId:org.id,userId:person.id,permissions:b.permissions,status:"ACTIVE",createdBy:q.user.id,updatedAt:new Date().toISOString()},{onConflict:"organizationId,userId"}).select().single();if(ie)throw ie;
 await audit(q.supabase,q.user.id,"ORGANIZATION_STAFF_ADDED","OrganizationStaff",data.id,{organizationId:org.id,permissions:b.permissions});s.status(201).json({staff:data});
}));
app.patch("/api/organization/staff/:id",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const b=z.object({status:z.enum(["ACTIVE","SUSPENDED"]),permissions:z.array(z.enum(staffPermissions)).min(1).optional()}).parse(q.body);
 const {data:org,error}=await q.supabase.from("Organization").select("id").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;if(!org)return s.status(404).json({error:"Organization not found."});
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
  let query=q.supabase.from("Certificate").select("id,certificateId,verificationKey,studentName,studentNumber,institution,programme,qualification,classification,awardDate,issuedAt,digest,txHash,status,revokedAt,revokeReason").order("issuedAt",{ascending:false}).limit(100);
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
  if(error) throw error;
  if(!c) return s.status(404).json({error:"Certificate not found."}); if(q.user.role==="EMPLOYER"){const {data:org}=await q.supabase.from("Organization").select("id,status").eq("ownerId",q.user.id).maybeSingle();if(!org||org.id!==c.organizationId||org.status!=="APPROVED")return s.status(403).json({error:"You can only revoke certificates issued by your approved organization."});}
  if(q.user.role==="GRADUATE"&&c.graduateId!==q.user.id) return s.status(403).json({error:"Access denied."});
  if(q.user.role==="EMPLOYER"){const {data:org,error:oe}=await q.supabase.from("Organization").select("id,status,type").eq("ownerId",q.user.id).maybeSingle();if(oe)throw oe;if(!org||org.id!==c.organizationId||org.status!=="APPROVED"||org.type!=="INSTITUTION")return s.status(403).json({error:"Only the issuing institution can generate its certificate QR."});}
  if(q.user.role==="GRADUATE"&&c.organizationId){const staff=staffForOrganization(await activeStaffFor(q.supabase,q.user.id),c.organizationId);if(staff&&!hasStaffPermission(staff,"certificates:read")&&c.graduateId!==q.user.id)return s.status(403).json({error:"Access denied."});}
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
  if(!spec||!Buffer.isBuffer(bytes)||bytes.length===0) return s.status(400).json({error:"Upload a PDF, JPEG or PNG certificate file."});
  if(bytes.length>10*1024*1024) return s.status(413).json({error:"The maximum file size is 10 MB."});
  if(!spec.magic(bytes)) return s.status(415).json({error:"The file content does not match its declared type."});
  const {data:org,error:orgError}=await q.supabase.from("Organization").select("id,status").eq("ownerId",q.user.id).maybeSingle();
  if(orgError) throw orgError;
  if(!org||org.status!=="APPROVED") return s.status(403).json({error:"Only an approved organization can upload official certificate documents."});
  const {data:orgType,error:typeError}=await q.supabase.from("Organization").select("type").eq("id",org.id).single();if(typeError)throw typeError;if(orgType.type!=="INSTITUTION")return s.status(403).json({error:"Only an academic issuing institution can upload official certificate documents."});
  const {data:cert,error:certError}=await q.supabase.from("Certificate").select("id,certificateId,organizationId").eq("certificateId",q.params.id).eq("organizationId",org.id).maybeSingle();
  if(certError) throw certError;
  if(!cert) return s.status(404).json({error:"Certificate not found in your organization."});
  const safeName=String(q.headers["x-file-name"]||("certificate."+spec.ext)).normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,120)||("certificate."+spec.ext);
  const fileId=crypto.randomUUID(), storagePath=`${org.id}/${cert.id}/${fileId}.${spec.ext}`;
  const sha256=digest(bytes);
   
  const {error:uploadError}=await q.supabase.storage.from("verity-certificates").upload(storagePath,bytes,{contentType:mime,upsert:false,cacheControl:"3600"});
  if(uploadError) throw uploadError;
  const metadata={id:fileId,certificateId:cert.id,organizationId:org.id,storagePath,originalName:safeName,mimeType:mime,sizeBytes:bytes.length,sha256,uploadedBy:q.user.id,scanStatus:"NOT_SCANNED"};
  const {data:doc,error:docError}=await q.supabase.from("CertificateDocument").insert(metadata).select("id,originalName,mimeType,sizeBytes,sha256,scanStatus,createdAt").single();
  if(docError){await q.supabase.storage.from("verity-certificates").remove([storagePath]);throw docError;}
  await audit(q.supabase,q.user.id,"CERTIFICATE_DOCUMENT_UPLOADED","CertificateDocument",doc.id,{certificateId:cert.certificateId,organizationId:org.id,sha256});

  s.status(201).json({document:doc,message:"Certificate document uploaded and stored privately."});
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
  if(error) throw error;if(!doc)return s.status(404).json({error:"Document not found."});
    if(q.user.role==="EMPLOYER"){
    const {data:org,error:oe}=await q.supabase.from("Organization").select("id").eq("ownerId",q.user.id).maybeSingle();
    if(oe)throw oe;if(!org||org.id!==doc.organizationId)return s.status(403).json({error:"Access denied."});
  }
  if(q.user.role==="GRADUATE"){
    const {data:c,error:ce}=await q.supabase.from("Certificate").select("graduateId").eq("id",doc.certificateId).maybeSingle();
    if(ce)throw ce;
    if(c?.graduateId!==q.user.id){
      const staff=staffForOrganization(await activeStaffFor(q.supabase,q.user.id),doc.organizationId);
      if(!hasStaffPermission(staff,"documents:download"))return s.status(403).json({error:"Your staff account does not have document-download permission."});
    }
  }
  const {data:link,error:linkError}=await q.supabase.storage.from("verity-certificates").createSignedUrl(doc.storagePath,60,{download:doc.originalName});
  if(linkError)throw linkError;
  await audit(q.supabase,q.user.id,"CERTIFICATE_DOCUMENT_DOWNLOADED","CertificateDocument",doc.id,{organizationId:doc.organizationId});
  s.json({url:link.signedUrl,expiresIn:60});
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
  const recomputed=digest(canonical(c)),dbOk=recomputed===c.digest,chain=await verifyOnChain(c.certificateId);
  const chainOk=!chain.enabled||(chain.exists===true&&chain.digest?.toLowerCase()===recomputed.toLowerCase()&&!chain.revoked);
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
  if(oe)throw oe;if(!org||org.type!=="EMPLOYER"||org.status!=="APPROVED")return s.status(403).json({error:"Only an approved verification organization can access shared documents."});
  const {data:grant,error:ge}=await q.supabase.from("CertificateAccessGrant").select("id,certificateId,status,expiresAt").eq("id",q.params.id).eq("organizationId",org.id).maybeSingle();
  if(ge)throw ge;if(!grant||grant.status!=="APPROVED"||(grant.expiresAt&&new Date(grant.expiresAt)<=new Date()))return s.status(403).json({error:"The graduate has not approved access, or the approval has expired."});
  const {data:doc,error:de}=await q.supabase.from("CertificateDocument").select("id,storagePath,originalName").eq("certificateId",grant.certificateId).order("createdAt",{ascending:false}).limit(1).maybeSingle();
  if(de)throw de;if(!doc)return s.status(404).json({error:"The institution has not uploaded an original certificate document yet."});
  const {data:link,error:le}=await q.supabase.storage.from("verity-certificates").createSignedUrl(doc.storagePath,60,{download:doc.originalName});
  if(le)throw le;
  await audit(q.supabase,q.user.id,"SHARED_CERTIFICATE_DOCUMENT_VIEWED","CertificateDocument",doc.id,{organizationId:org.id,grantId:grant.id});
  s.json({url:link.signedUrl,expiresIn:60,originalName:doc.originalName});
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
  app.listen(PORT,"0.0.0.0",()=>console.log(`Verity listening on ${PORT}`));
}
start().catch(e=>{console.error(e);process.exit(1);});