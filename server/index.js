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
import { STAFF_PERMISSIONS, isValidStaffPermissions, hasStaffPermission } from "./staff-permissions.js";
import { isCertificateAccessActive } from "./certificate-access.js";
import { parseRosterCsv } from "./student-roster.js";
import { createVerificationRateLimiter } from "./rate-limits.js";
import { startStudentImportWorker } from "./student-import-worker.js";
import { startBulkCertificateWorker } from "./bulk-certificate-worker.js";
import { createBulkCertificateProcessor } from "./bulk-certificate-service.js";
import { renderCertificateDocument, renderCertificatePreview, validateFieldLayout } from "./certificate-renderer.js";

const app = express();
const PORT = Number(process.env.PORT || 8080);
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "";
const root = path.dirname(fileURLToPath(import.meta.url));
const configured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
const SUPABASE_SERVER_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
const STUDENT_IMPORT_WORKER_ENABLED = process.env.ENABLE_STUDENT_IMPORT_WORKER === "true" && Boolean(SUPABASE_SERVER_KEY);
const BULK_CERTIFICATE_WORKER_ENABLED = process.env.ENABLE_BULK_CERTIFICATE_WORKER === "true" && Boolean(SUPABASE_SERVER_KEY);
const makeClient = (accessToken) => {
  if (!configured) throw new Error("Supabase is not configured. Add the Project URL and Publishable Key.");
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {})
  });
};
const makeServerClient = () => {
  if(!configured || !SUPABASE_SERVER_KEY) throw new Error("A server-only Supabase service key is required for protected server operations.");
  return createClient(SUPABASE_URL,SUPABASE_SERVER_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
};
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const canonical = c => JSON.stringify({
  certificateId:c.certificateId, studentName:c.studentName.trim(), studentNumber:c.studentNumber.trim(),
  institution:c.institution.trim(), faculty:c.faculty.trim(), department:c.department.trim(),
  programme:c.programme.trim(), qualification:c.qualification.trim(), classification:c.classification||"",
  awardDate:new Date(c.awardDate).toISOString()
});
const safe = u => ({id:u.id,fullName:u.fullName,email:u.email,role:u.role,institution:u.institution});
async function verifyCertificateChain(certificate) {
  if (!certificate?.txHash || !certificate?.chainId || !certificate?.contractAddress) {
    return { enabled: false, mode: "SUPABASE_PRIMARY", reason: "This credential is verified against its Supabase record; no blockchain anchor is attached." };
  }
  return verifyOnChain(certificate.certificateId);
}

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
 const organizationType=m.organizationType==="EMPLOYER"?"EMPLOYER":"INSTITUTION";
 const allowedLevels=["PRIMARY","SECONDARY","TERTIARY"];
 const educationLevels=organizationType==="INSTITUTION"&&Array.isArray(m.educationLevels)
   ?[...new Set(m.educationLevels.filter(level=>allowedLevels.includes(level)))]
   :organizationType==="INSTITUTION"?["TERTIARY"]:[];
 const org={id:crypto.randomUUID(),name,type:organizationType,educationLevels,ownerId:profile.id,status:"PENDING",registrationCode:"VRT-"+crypto.randomBytes(4).toString("hex").toUpperCase(),registrationNumber,officialWebsite:m.officialWebsite||null,officialEmailDomain:m.officialEmailDomain||null,accreditationBody:m.accreditationBody||null,locationCity:m.locationCity||null,locationState:m.locationState||null,locationCountry:m.locationCountry||null};
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
async function institutionRosterContext(client,userId) {
 const {data:owned,error:oe}=await client.from("Organization").select("id,name,type,status,ownerId,registrationCode,registrationCodeExpiryEnabled,registrationCodeExpiresAt").eq("ownerId",userId).maybeSingle();
 if(oe)throw oe;
 if(owned)return owned;
 const {data:staff,error:se}=await client.from("InstitutionICTStaff").select("organizationId,permissions,status").eq("userId",userId).eq("status","ACTIVE").limit(10);
 if(se)throw se;
 const active=(staff||[]).find(x=>x.permissions?.some(p=>["roster:manage","registration:recover"].includes(p)));
 if(!active)return null;
 const {data:org,error}=await client.from("Organization").select("id,name,type,status,ownerId,registrationCode,registrationCodeExpiryEnabled,registrationCodeExpiresAt").eq("id",active.organizationId).maybeSingle();
 if(error)throw error;
 return org?{...org,_ictPermissions:active.permissions}:null;
}
function hasInstitutionPermission(org,permission,userId) {
 if(org?.ownerId===userId)return true;
 return org?._ictPermissions?.includes(permission)===true;
}

const run = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
async function publicIssuerDetails(client, certificateId) {
 const {data,error}=await client.rpc("verity_public_certificate_issuer",{p_certificate_id:certificateId});
 if(error)throw error;
 const o=Array.isArray(data)?data[0]:data;
 if(!o)return null;
 return {name:o.name,type:o.type,registrationNumber:o.registrationNumber||null,officialWebsite:o.officialWebsite||null,officialEmailDomain:o.officialEmailDomain||null,accreditationBody:o.accreditationBody||null,verifiedAt:o.verifiedAt||null,locationCity:o.locationCity||null,locationState:o.locationState||null,locationCountry:o.locationCountry||null,verificationStatus:"VERITY_APPROVED"};
}

app.set("trust proxy",1);
const isProduction=process.env.NODE_ENV==="production";
app.use(helmet({
  crossOriginResourcePolicy:{policy:"cross-origin"},
  contentSecurityPolicy:isProduction?{directives:{
    defaultSrc:["'self'"],baseUri:["'self'"],frameAncestors:["'none'"],objectSrc:["'none'"],
    scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],
    imgSrc:["'self'","data:","blob:","https://*.supabase.co"],
    fontSrc:["'self'","data:"],
    connectSrc:["'self'","https://*.supabase.co","wss://*.supabase.co"],
    workerSrc:["'self'","blob:"],frameSrc:["'self'","blob:"],formAction:["'self'"],
    upgradeInsecureRequests:[]
  }}:false
}));
const corsOrigins=[...new Set([
  ...(process.env.CORS_ORIGIN||"").split(",").map(value=>value.trim()).filter(Boolean),
  process.env.PUBLIC_APP_URL?.trim()
].filter(Boolean))];
app.use(cors({
  origin:corsOrigins.length?corsOrigins:false,
  credentials:true,
  allowedHeaders:["Authorization","Content-Type","X-File-Name"],
  methods:["GET","POST","PUT","PATCH","DELETE","OPTIONS"]
}));
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

const ORGANIZATION_CAPABILITIES=["ISSUE_CREDENTIALS","VERIFY_CREDENTIALS"];
async function hasApprovedOrganizationCapability(client,organizationId,capability) {
 const {data,error}=await client.from("OrganizationCapability").select("id")
   .eq("organizationId",organizationId).eq("capability",capability).eq("status","APPROVED").maybeSingle();
 if(error)throw error;
 return Boolean(data);
}
async function organizationCapabilities(client,organizationId) {
 const {data,error}=await client.from("OrganizationCapability")
   .select("id,capability,status,requestNote,decisionNote,createdAt,updatedAt,reviewedAt")
   .eq("organizationId",organizationId)
   .order("createdAt",{ascending:true});
 if(error)throw error;
 return data||[];
}
async function activeStaffFor(client,userId) {
 const {data:staff,error}=await client.from("OrganizationStaff").select("id,organizationId,permissions,status").eq("userId",userId).eq("status","ACTIVE");
 if(error) throw error;
 const rows=staff||[];
 if(!rows.length)return [];
 const organizationIds=[...new Set(rows.map(x=>x.organizationId))];
 const {data:organizations,error:orgError}=await client.from("Organization").select("id,status,type").in("id",organizationIds);
 if(orgError)throw orgError;
 const approved=new Set((organizations||[]).filter(x=>x.status==="APPROVED"&&x.type==="INSTITUTION").map(x=>x.id));
 return rows
   .filter(x=>approved.has(x.organizationId))
   .filter(x=>isValidStaffPermissions(x.permissions));
}
const staffForOrganization=(staff,organizationId)=>staff.find(x=>x.organizationId===organizationId)||null;
async function audit(client,actorId,action,entity,entityId,metadata={}) {
  const {error}=await client.from("AuditEvent").insert({id:crypto.randomUUID(),actorId,action,entity,entityId,metadata,createdAt:new Date().toISOString()});
  if(error) throw error;
}


async function createVerityNotification(userId,{type,category="ACCOUNT",title,body,url="/",metadata={}}){
 if(!userId||!SUPABASE_SERVER_KEY)return;
 const db=createClient(SUPABASE_URL,SUPABASE_SERVER_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const {data:pref}=await db.from("NotificationPreference").select("inAppEnabled,pushEnabled").eq("userId",userId).eq("category",category).maybeSingle();
  if(pref?.inAppEnabled!==false){
   const {error}=await db.from("Notification").insert({id:crypto.randomUUID(),userId,type,category,title,body,url,metadata,createdAt:new Date().toISOString()});
   if(error)throw error;
  }
  if(pref?.pushEnabled!==false)await sendVerityPush([userId],{title:"VERITY · "+title,body,url});
 }catch(error){console.error("VERITY notification event failed:",error.message);}
}
async function notifyVerityAdmins(payload){
 if(!SUPABASE_SERVER_KEY)return;
 const db=createClient(SUPABASE_URL,SUPABASE_SERVER_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:admins,error}=await db.from("User").select("id").eq("role","ADMIN");
 if(error)throw error;
 await Promise.all((admins||[]).map(a=>createVerityNotification(a.id,payload)));
}

app.get("/api/health",(_q,s)=>s.json({status:"ok",database:configured?"supabase_data_api_configured":"not_configured",blockchain:chainStatus(),notifications:{inAppConfigured:Boolean(SUPABASE_SERVER_KEY),browserPushConfigured:Boolean(SUPABASE_SERVER_KEY&&process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY),adminEmailConfigured:Boolean(process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASS&&process.env.SMTP_FROM)},documentSecurity:{storage:"private",integrity:"sha256_verified_on_download",malwareScanning:false,maximumUploadBytes:10485760},workers:{studentRosterImport:STUDENT_IMPORT_WORKER_ENABLED,bulkCertificateIssuance:BULK_CERTIFICATE_WORKER_ENABLED}}));

app.get("/api/directory/organizations",run(async(q,s)=>{
 const term=String(q.query.search||"").trim().slice(0,100);
 const location=String(q.query.location||"").trim().slice(0,100);
 const type=String(q.query.type||"ALL").toUpperCase();
 if(!["ALL","INSTITUTION","EMPLOYER"].includes(type))return s.status(400).json({error:"Invalid organization type filter."});
 const db=makeClient();
 const {data,error}=await db.rpc("verity_public_organization_directory",{p_search:term||null,p_type:type,p_location:location||null});
 if(error)throw error;
 s.setHeader("Cache-Control","public, max-age=60, stale-while-revalidate=300");
 s.json({organizations:(data||[]).map(o=>({name:o.name,type:o.type,registrationNumber:o.registrationNumber||null,officialWebsite:o.officialWebsite||null,officialEmailDomain:o.officialEmailDomain||null,accreditationBody:o.accreditationBody||null,verifiedAt:o.verifiedAt||null,locationCity:o.locationCity||null,locationState:o.locationState||null,locationCountry:o.locationCountry||null,verificationStatus:"VERITY_APPROVED"}))});
}));

app.post("/api/auth/register",run(async(q,s)=>{
  const b=z.object({fullName:z.string().min(2),email:z.string().email(),password:z.string().min(10),role:z.enum(["GRADUATE","EMPLOYER"]),institution:z.string().optional(),organizationName:z.string().optional(),organizationType:z.enum(["INSTITUTION","EMPLOYER"]).optional(),educationLevels:z.array(z.enum(["PRIMARY","SECONDARY","TERTIARY"])).max(3).optional(),registrationNumber:z.string().max(100).optional(),officialWebsite:z.string().max(300).optional(),officialEmailDomain:z.string().max(150).optional(),accreditationBody:z.string().max(200).optional(),locationCity:z.string().max(100).optional(),locationState:z.string().max(100).optional(),locationCountry:z.string().max(100).optional(),organizationCode:z.string().optional(),studentNumber:z.string().optional(),studentOrganizationId:z.string().optional()}).parse(q.body);if(b.role==="EMPLOYER"&&b.organizationType==="INSTITUTION"&&Array.isArray(b.educationLevels)&&b.educationLevels.length===0)return s.status(400).json({error:"Select at least one education level served by this school."}); const locationParts=[b.locationCity,b.locationState,b.locationCountry];if(locationParts.some(v=>String(v||"").trim())&&locationParts.some(v=>!String(v||"").trim()))return s.status(400).json({error:"Provide city, state / region and country together, or leave all three blank."}); if(b.role==="EMPLOYER"&&String(b.organizationName||b.institution||"").trim().length<2)return s.status(400).json({error:"Enter your organization name."});
  if(b.role==="GRADUATE"){
   const studentNumber=String(b.studentNumber||"").trim(),organizationId=String(b.studentOrganizationId||"").trim();
   if(!organizationId||studentNumber.length<2)return s.status(400).json({error:"Select your school or issuer organization and enter your student or employee number before creating a graduate account."});
   const {data:eligible,error:precheckError}=await makeServerClient().rpc("verity_student_registration_precheck",{p_organization_id:organizationId,p_student_number:studentNumber});if(precheckError)throw precheckError;
   if(eligible!==true)return s.status(400).json({error:"Your record could not be prepared for activation. Check the student or employee number with the organization administrator."});
  }
  const client=makeClient();
  const {data,error}=await client.auth.signUp({
    email:b.email.trim().toLowerCase(),password:b.password,
    options:{data:{fullName:b.fullName.trim(),institution:b.institution?.trim()||"",role:b.role,organizationName:b.organizationName?.trim()||"",organizationType:b.organizationType||"INSTITUTION",educationLevels:b.educationLevels||["TERTIARY"],registrationNumber:b.registrationNumber?.trim()||"",officialWebsite:b.officialWebsite?.trim()||"",officialEmailDomain:b.officialEmailDomain?.trim().toLowerCase()||"",accreditationBody:b.accreditationBody?.trim()||"",locationCity:b.locationCity?.trim()||"",locationState:b.locationState?.trim()||"",locationCountry:b.locationCountry?.trim()||"",organizationCode:b.organizationCode?.trim().toUpperCase()||"",studentNumber:b.studentNumber?.trim()||"",studentOrganizationId:b.studentOrganizationId?.trim()||""}}
  });
  if(error) {
    const duplicate=/already registered|already exists|user exists/i.test(error.message||"");
    return s.status(duplicate?409:400).json({error:duplicate?"An account using this email already exists. Please sign in, or use account recovery if you cannot access it.":error.message});
  }
  if(Array.isArray(data.user?.identities)&&data.user.identities.length===0) return s.status(409).json({error:"An account using this email already exists. Please sign in instead of creating another account."});
  if(!data.session) return s.status(201).json({pendingEmailConfirmation:true,message:"Your account request was accepted. Check your email if confirmation is enabled, then sign in."});
  const profile=await profileFor(client,data.user); const organization=await ensureOrganization(client,data.user,profile); await ensureStudentMembership(client,data.user,profile);
  if(organization)await notifyVerityAdmins({type:"ORGANIZATION_REGISTERED",category:"PLATFORM",title:"New organization registration",body:organization.name+" submitted a registration for review.",url:"/organizations",metadata:{organizationId:organization.id}});
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
app.get("/api/auth/me",auth,run(async(q,s)=>{const organization=await ensureOrganization(q.supabase,q.authUser,q.user);await ensureStudentMembership(q.supabase,q.authUser,q.user);const organizationStaff=q.user.role==="GRADUATE"?await activeStaffFor(q.supabase,q.user.id):[];const {data:institutionICT,error:ictError}=q.user.role==="GRADUATE"?await q.supabase.from("InstitutionICTStaff").select("id,organizationId,permissions,status").eq("userId",q.user.id).eq("status","ACTIVE"): {data:[],error:null};if(ictError)throw ictError;const studentRegistration=q.user.role==="GRADUATE"?{organizationId:q.authUser.user_metadata?.studentOrganizationId||null,studentNumber:q.authUser.user_metadata?.studentNumber||null}:null;const rosterOrganization=q.user.role==="GRADUATE"&&institutionICT?.some(x=>x.status==="ACTIVE"&&x.permissions?.some(p=>["roster:manage","registration:recover"].includes(p)))?await institutionRosterContext(q.supabase,q.user.id):null;const workspaceOrganization=organization||(rosterOrganization?{id:rosterOrganization.id,name:rosterOrganization.name,type:rosterOrganization.type,status:rosterOrganization.status,ownerId:rosterOrganization.ownerId}:null);const organizationWithCapabilities=organization?{...organization,capabilities:await organizationCapabilities(q.supabase,organization.id)}:workspaceOrganization;s.json({user:{...safe(q.user),organizationStaff,institutionICT:institutionICT||[],studentRegistration},organization:organizationWithCapabilities});}));
app.patch("/api/admin/profile",auth,roles("ADMIN"),run(async(q,s)=>{const b=z.object({fullName:z.string().trim().min(2).max(100)}).parse(q.body);const {data,error}=await q.supabase.from("User").update({fullName:b.fullName}).eq("id",q.user.id).select("id,fullName,email,role,institution").single();if(error)throw error;await audit(q.supabase,q.user.id,"ADMIN_PROFILE_NAME_UPDATED","User",q.user.id,{fullName:b.fullName});s.json({user:safe(data),message:"Administrator display name updated."});}));
app.post("/api/organization/request-membership",auth,roles("GRADUATE"),run(async(q,s)=>{const b=z.object({registrationCode:z.string().min(6),studentNumber:z.string().optional()}).parse(q.body);const {data,error}=await q.supabase.rpc("request_verity_membership",{p_registration_code:b.registrationCode.trim().toUpperCase(),p_student_number:b.studentNumber||null});if(error)return s.status(400).json({error:error.message});s.status(201).json({membership:data});}));
app.get("/api/organization/my-membership",auth,roles("GRADUATE"),run(async(q,s)=>{const {data,error}=await q.supabase.from("Membership").select("id,status,studentNumber,createdAt,Organization:organizationId(name,type,status)").eq("userId",q.user.id).order("createdAt",{ascending:false});if(error)throw error;s.json({memberships:data||[]});}));
app.get("/api/organization",auth,roles("EMPLOYER"),run(async(q,s)=>{const {data,error}=await q.supabase.from("Organization").select("*").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;s.json({organization:data});}));

app.get("/api/organization/capabilities",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const {data:org,error}=await q.supabase.from("Organization").select("id,status,type").eq("ownerId",q.user.id).maybeSingle();
 if(error)throw error;if(!org)return s.status(404).json({error:"Organization not found."});
 s.json({organization:org,capabilities:await organizationCapabilities(q.supabase,org.id)});
}));
app.post("/api/organization/capabilities",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const b=z.object({capability:z.enum(ORGANIZATION_CAPABILITIES),requestNote:z.string().trim().max(1000).optional()}).parse(q.body);
 const {data:org,error}=await q.supabase.from("Organization").select("id,name,status,type").eq("ownerId",q.user.id).maybeSingle();
 if(error)throw error;if(!org)return s.status(404).json({error:"Organization not found."});
 const {data:existing,error:lookupError}=await q.supabase.from("OrganizationCapability").select("id,status").eq("organizationId",org.id).eq("capability",b.capability).maybeSingle();
 if(lookupError)throw lookupError;
 const now=new Date().toISOString();
 let capability,capabilityError;
 if(existing?.status==="REJECTED"){
   const result=await q.supabase.from("OrganizationCapability").update({
     status:"PENDING",requestedBy:q.user.id,requestNote:b.requestNote||null,
     decisionNote:null,reviewedBy:null,reviewedAt:null,updatedAt:now
   }).eq("id",existing.id).eq("status","REJECTED").select().single();
   capability=result.data;capabilityError=result.error;
 }else if(existing){
   return s.status(409).json({error:existing.status==="APPROVED"?"This capability is already approved.":existing.status==="SUSPENDED"?"This capability is suspended. Contact VERITY support for review.":"A request for this capability is already awaiting administrator review."});
 }else{
   const result=await q.supabase.from("OrganizationCapability").insert({
     id:crypto.randomUUID(),organizationId:org.id,capability:b.capability,status:"PENDING",
     requestedBy:q.user.id,requestNote:b.requestNote||null,createdAt:now,updatedAt:now
   }).select().single();
   capability=result.data;capabilityError=result.error;
 }
 if(capabilityError)throw capabilityError;
 await audit(q.supabase,q.user.id,"ORGANIZATION_CAPABILITY_REQUESTED","OrganizationCapability",capability.id,{organizationId:org.id,capability:b.capability});
 await notifyVerityAdmins({type:"ORGANIZATION_CAPABILITY_REQUESTED",category:"PLATFORM",title:"Organization capability request",body:org.name+" requested "+b.capability.replaceAll("_"," ").toLowerCase()+".",url:"/organizations",metadata:{organizationId:org.id,capability:b.capability}});
 s.status(201).json({capability,message:"Your capability request has been submitted for separate VERITY administrator review."});
}));

app.get("/api/admin/organization-capabilities",auth,roles("ADMIN"),run(async(q,s)=>{
 const {data:rows,error}=await q.supabase.from("OrganizationCapability").select("*").order("createdAt",{ascending:false});
 if(error)throw error;
 const ids=[...new Set((rows||[]).map(x=>x.organizationId))];
 const {data:organizations,error:orgError}=ids.length?await q.supabase.from("Organization").select("id,name,type,status,ownerId").in("id",ids):{data:[],error:null};
 if(orgError)throw orgError;
 s.json({requests:(rows||[]).map(row=>({...row,isLegacyBaseline:row.requestNote==="Existing organization capability preserved during additive VERITY expansion.",organization:(organizations||[]).find(org=>org.id===row.organizationId)||null}))});
}));
app.patch("/api/admin/organization-capabilities/:id",auth,roles("ADMIN"),run(async(q,s)=>{
 const b=z.object({status:z.enum(["APPROVED","REJECTED","SUSPENDED"]),decisionNote:z.string().trim().max(1000).optional()}).parse(q.body);
 const {data:current,error:lookupError}=await q.supabase.from("OrganizationCapability").select("id,organizationId,capability,status").eq("id",q.params.id).maybeSingle();
 if(lookupError)throw lookupError;if(!current)return s.status(404).json({error:"Capability request not found."});
 const {data:org,error:orgError}=await q.supabase.from("Organization").select("id,name,status,ownerId").eq("id",current.organizationId).single();
 if(orgError)throw orgError;
 if(b.status==="APPROVED"&&org.status!=="APPROVED")return s.status(409).json({error:"Approve the organization's identity application before approving its requested capability."});
 const now=new Date().toISOString();
 const {data:updated,error}=await q.supabase.from("OrganizationCapability").update({
   status:b.status,decisionNote:b.decisionNote||null,reviewedBy:q.user.id,reviewedAt:now,updatedAt:now
 }).eq("id",current.id).select().single();
 if(error)throw error;
 await audit(q.supabase,q.user.id,"ORGANIZATION_CAPABILITY_"+b.status,"OrganizationCapability",updated.id,{organizationId:org.id,capability:current.capability,decisionNote:b.decisionNote||null});
 if(org.ownerId)await createVerityNotification(org.ownerId,{type:"ORGANIZATION_CAPABILITY_STATUS",category:"ACCOUNT",title:"Organization capability review updated",body:"Your "+current.capability.replaceAll("_"," ").toLowerCase()+" request was "+b.status.toLowerCase()+".",url:"/identity",metadata:{organizationId:org.id,capability:current.capability,status:b.status}});
 s.json({capability:updated});
}));

app.patch("/api/organization/identity",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const b=z.object({registrationNumber:z.string().max(100).optional(),officialWebsite:z.string().max(300).optional(),officialEmailDomain:z.string().max(150).optional(),accreditationBody:z.string().max(200).optional(),locationCity:z.string().max(100).optional(),locationState:z.string().max(100).optional(),locationCountry:z.string().max(100).optional()}).parse(q.body);
 const locationParts=[b.locationCity,b.locationState,b.locationCountry];if(locationParts.some(v=>String(v||"").trim())&&locationParts.some(v=>!String(v||"").trim()))return s.status(400).json({error:"Provide city, state / region and country together, or leave all three blank."});
 const {data:org,error:oe}=await q.supabase.from("Organization").select("id,type,status,educationLevels").eq("ownerId",q.user.id).maybeSingle();if(oe)throw oe;
 if(!org)return s.status(404).json({error:"Organization not found."});
 if(org.status!=="PENDING"){
   const submittedKeys=Object.keys(q.body||{});
   if(org.status!=="APPROVED"||!submittedKeys.length||submittedKeys.some(k=>!["locationCity","locationState","locationCountry"].includes(k)))return s.status(403).json({error:"Approved organizations may update only their public location here. Legal identity changes require a new VERITY review."});
   const locationPatch={locationCity:b.locationCity?.trim()||null,locationState:b.locationState?.trim()||null,locationCountry:b.locationCountry?.trim()||null,updatedAt:new Date().toISOString()};
   const {data,error}=await q.supabase.from("Organization").update(locationPatch).eq("id",org.id).eq("ownerId",q.user.id).select("*").single();if(error)throw error;
   await audit(q.supabase,q.user.id,"ORGANIZATION_PUBLIC_LOCATION_UPDATED","Organization",org.id,{locationCity:locationPatch.locationCity,locationState:locationPatch.locationState,locationCountry:locationPatch.locationCountry});
   return s.json({organization:data,message:"Public location updated. The directory labels it as organization-reported."});
 }
 const patch={registrationNumber:b.registrationNumber?.trim()||null,officialWebsite:b.officialWebsite?.trim()||null,officialEmailDomain:b.officialEmailDomain?.trim().toLowerCase()||null,accreditationBody:b.accreditationBody?.trim()||null,locationCity:b.locationCity?.trim()||null,locationState:b.locationState?.trim()||null,locationCountry:b.locationCountry?.trim()||null,updatedAt:new Date().toISOString()};
 const requiresTertiaryEvidence=org.type==="INSTITUTION"&&(org.educationLevels||[]).includes("TERTIARY");if(org.type==="INSTITUTION"&&(!patch.registrationNumber||!patch.accreditationBody||(requiresTertiaryEvidence&&!patch.officialWebsite)))return s.status(400).json({error:requiresTertiaryEvidence?"Tertiary institutions must provide a registration number, official website and accreditation body.":"Primary/secondary schools must provide their official school registration number and supervising or accreditation body."});
 if(patch.officialWebsite&&!/^https?:\/\//i.test(patch.officialWebsite))return s.status(400).json({error:"Enter the official website with https:// or http://."});
 const {data,error}=await q.supabase.from("Organization").update(patch).eq("id",org.id).eq("ownerId",q.user.id).select("*").single();if(error)throw error;
 await audit(q.supabase,q.user.id,"ORGANIZATION_IDENTITY_UPDATED","Organization",org.id,{organizationId:org.id});
 s.json({organization:data});
}));

const staffPermissionArray=z.array(z.enum(STAFF_PERMISSIONS)).min(1).refine(isValidStaffPermissions,{message:"Only certificates:read and documents:download are supported; document downloads require certificate-read access."});
app.get("/api/organization/staff",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const {data:org,error}=await q.supabase.from("Organization").select("id,status,type").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;if(!org)return s.json({staff:[]});if(org.type!=="INSTITUTION")return s.status(403).json({error:"Organization staff access is currently available to academic institutions only. Verifier-organization staff permissions require a dedicated verification permission."});
 const {data,error:e}=await q.supabase.from("OrganizationStaff").select("id,userId,permissions,status,createdAt").eq("organizationId",org.id).order("createdAt",{ascending:false});if(e)throw e;
 const ids=(data||[]).map(x=>x.userId);const {data:users,error:ue}=ids.length?await q.supabase.from("User").select("id,fullName,email,role").in("id",ids):{data:[],error:null};if(ue)throw ue;
 s.json({staff:(data||[]).map(x=>({...x,user:(users||[]).find(u=>u.id===x.userId)||null})),organizationStatus:org.status});
}));
app.post("/api/organization/staff",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const b=z.object({email:z.string().email(),permissions:staffPermissionArray}).parse(q.body);
 const {data:org,error}=await q.supabase.from("Organization").select("id,status,type").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;if(!org||org.status!=="APPROVED"||org.type!=="INSTITUTION")return s.status(403).json({error:"Only an approved academic institution can add staff. Verifier-organization staff permissions are not implemented yet."});
 const {data:person,error:pe}=await q.supabase.from("User").select("id,email,role").ilike("email",b.email.trim()).maybeSingle();if(pe)throw pe;if(!person)return s.status(404).json({error:"This person must create a Verity account before you can add them."});if(person.id===q.user.id)return s.status(400).json({error:"The organization owner is already an administrator."});if(person.role==="ADMIN"||person.role==="EMPLOYER")return s.status(400).json({error:"This account cannot be assigned as organization staff."});
 const {data:existing,error:existingError}=await q.supabase.from("OrganizationStaff").select("id").eq("organizationId",org.id).eq("userId",person.id).maybeSingle();if(existingError)throw existingError;
 let staffData,staffError;
 if(existing){
   const result=await q.supabase.from("OrganizationStaff").update({permissions:b.permissions,status:"ACTIVE",updatedAt:new Date().toISOString()}).eq("id",existing.id).eq("organizationId",org.id).select().single();
   staffData=result.data;staffError=result.error;
 }else{
   const result=await q.supabase.from("OrganizationStaff").insert({id:crypto.randomUUID(),organizationId:org.id,userId:person.id,permissions:b.permissions,status:"ACTIVE",createdBy:q.user.id,updatedAt:new Date().toISOString()}).select().single();
   staffData=result.data;staffError=result.error;
 }
 if(staffError)throw staffError;
 await audit(q.supabase,q.user.id,existing?"ORGANIZATION_STAFF_REACTIVATED":"ORGANIZATION_STAFF_ADDED","OrganizationStaff",staffData.id,{organizationId:org.id,permissions:b.permissions});s.status(existing?200:201).json({staff:staffData});
}));
app.patch("/api/organization/staff/:id",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const b=z.object({status:z.enum(["ACTIVE","SUSPENDED"]),permissions:staffPermissionArray.optional()}).parse(q.body);
 const {data:org,error}=await q.supabase.from("Organization").select("id,status,type").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;if(!org)return s.status(404).json({error:"Organization not found."});if(org.status!=="APPROVED"||org.type!=="INSTITUTION")return s.status(403).json({error:"Only an approved academic institution can manage staff assignments."});
 const patch={status:b.status,updatedAt:new Date().toISOString()};if(b.permissions)patch.permissions=b.permissions;
 const {data,error:e}=await q.supabase.from("OrganizationStaff").update(patch).eq("id",q.params.id).eq("organizationId",org.id).select().single();if(e)throw e;
 await audit(q.supabase,q.user.id,"ORGANIZATION_STAFF_"+b.status,"OrganizationStaff",data.id,{organizationId:org.id,permissions:data.permissions});s.json({staff:data});
}));


app.patch("/api/organization/registration-code-policy",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const b=z.object({enabled:z.boolean(),expiresAt:z.string().datetime().optional()}).parse(q.body);
 const {data:org,error}=await q.supabase.from("Organization").select("id,type,status").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;
 if(!org||org.status!=="APPROVED"||!(await hasApprovedOrganizationCapability(q.supabase,org.id,"ISSUE_CREDENTIALS")))return s.status(403).json({error:"Only an approved credential issuer can configure its registration-code policy."});
 if(b.enabled&&(!b.expiresAt||new Date(b.expiresAt)<=new Date()))return s.status(400).json({error:"Choose a future expiry date, or leave expiry disabled."});
 const patch={registrationCodeExpiryEnabled:b.enabled,registrationCodeExpiresAt:b.enabled?b.expiresAt:null,updatedAt:new Date().toISOString()};
 const {data,error:saveError}=await q.supabase.from("Organization").update(patch).eq("id",org.id).eq("ownerId",q.user.id).select("id,registrationCodeExpiryEnabled,registrationCodeExpiresAt").single();if(saveError)throw saveError;
 await audit(q.supabase,q.user.id,"INSTITUTION_REGISTRATION_CODE_POLICY_UPDATED","Organization",org.id,{enabled:b.enabled,expiresAt:patch.registrationCodeExpiresAt});
 s.json({policy:data});
}));
app.post("/api/organization/registration-code/rotate",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const {data:org,error}=await q.supabase.from("Organization").select("id,type,status").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;
 if(!org||org.status!=="APPROVED"||!(await hasApprovedOrganizationCapability(q.supabase,org.id,"ISSUE_CREDENTIALS")))return s.status(403).json({error:"Only an approved credential issuer can rotate its registration code."});
 const code="VRT-"+crypto.randomBytes(8).toString("hex").toUpperCase();
 const {data,error:saveError}=await q.supabase.from("Organization").update({registrationCode:code,updatedAt:new Date().toISOString()}).eq("id",org.id).eq("ownerId",q.user.id).select("registrationCode").single();if(saveError)throw saveError;
 await audit(q.supabase,q.user.id,"INSTITUTION_REGISTRATION_CODE_ROTATED","Organization",org.id,{});
 s.json({registrationCode:save.registrationCode,message:"A new invitation code is active. Existing student memberships are unchanged."});
}));

app.get("/api/student/registration-options",run(async(q,s)=>{
 const {data,error}=await makeClient().rpc("verity_student_signup_institutions");
 if(error)throw error;
 s.json({institutions:(Array.isArray(data)?data:[]).map(o=>({id:o.id,name:o.name,location:[o.locationCity,o.locationState,o.locationCountry].filter(Boolean).join(", ")})).sort((a,b)=>a.name.localeCompare(b.name))});
}));
app.get("/api/student/registration-context",auth,roles("GRADUATE"),run(async(q,s)=>{
 const metadata=q.authUser.user_metadata||{},organizationId=metadata.studentOrganizationId||null,studentNumber=metadata.studentNumber||null;
 let institution=null;
 if(organizationId&&studentNumber){const server=makeServerClient();const {data:issuers,error}=await server.rpc("verity_student_signup_institutions");if(error)throw error;const issuer=(issuers||[]).find(x=>x.id===organizationId);if(issuer){const {data:eligible,error:precheckError}=await server.rpc("verity_student_registration_precheck",{p_organization_id:organizationId,p_student_number:studentNumber});if(precheckError)throw precheckError;if(eligible===true)institution={id:issuer.id,name:issuer.name};}}
 s.json({institution,studentNumber,needsActivation:!q.user.id?false:true});
}));
app.post("/api/student/activate",auth,roles("GRADUATE"),run(async(q,s)=>{
 const b=z.object({organizationId:z.string().min(1),studentNumber:z.string().trim().min(2).max(80),activationToken:z.string().trim().min(16).max(100)}).parse(q.body);
 const metadata=q.authUser.user_metadata||{};
 if(metadata.studentOrganizationId&&metadata.studentOrganizationId!==b.organizationId)return s.status(403).json({error:"This account's student registration is linked to a different institution. Contact VERITY support if this is incorrect."});
 if(metadata.studentNumber&&metadata.studentNumber.toUpperCase().replace(/\s+/g,"")!==b.studentNumber.toUpperCase().replace(/\s+/g,""))return s.status(403).json({error:"The matriculation number does not match the one supplied during account registration."});
 const tokenHash=crypto.createHash("sha256").update(b.activationToken).digest("hex");
 const {data,error}=await q.supabase.rpc("activate_verity_student_roster",{p_organization_id:b.organizationId,p_student_number:b.studentNumber,p_token_hash:tokenHash});
 if(error)return s.status(400).json({error:error.message||"Student activation could not be completed."});
 await audit(q.supabase,q.user.id,"STUDENT_ROSTER_ACTIVATED","StudentRoster",b.organizationId,{institutionId:b.organizationId});
 s.json({activation:data,message:"Your student record is now securely linked to the institution."});
}));
app.post("/api/institution/activation-tokens/export",auth,run(async(q,s)=>{
 const org=await institutionRosterContext(q.supabase,q.user.id);
 if(!org||org.status!=="APPROVED"||!(await hasApprovedOrganizationCapability(q.supabase,org.id,"ISSUE_CREDENTIALS"))||!hasInstitutionPermission(org,"roster:manage",q.user.id))return s.status(403).json({error:"An approved credential issuer owner or authorized ICT roster manager is required."});
 const {data:students,error}=await q.supabase.from("StudentRoster").select("id,studentNumber,fullName").eq("organizationId",org.id).eq("status","ELIGIBLE").is("claimedUserId",null).order("studentNumber").limit(10000);if(error)throw error;
 const {data:existing,error:te}=await q.supabase.from("StudentActivationToken").select("rosterId,usedAt,revokedAt").eq("organizationId",org.id);if(te)throw te;
 const tokenByRoster=new Map((existing||[]).map(t=>[t.rosterId,t]));
 const output=[];
 for(const student of students||[]){
  const previous=tokenByRoster.get(student.id);
  if(previous&&(!previous.revokedAt||previous.usedAt))continue;
  const raw=crypto.randomBytes(24).toString("base64url");
  const row={id:crypto.randomUUID(),organizationId:org.id,rosterId:student.id,tokenHash:crypto.createHash("sha256").update(raw).digest("hex"),tokenLastFour:raw.slice(-4),issuedBy:q.user.id,createdAt:new Date().toISOString(),expiresAt:null,usedAt:null,usedBy:null,revokedAt:null};
  output.push({studentNumber:student.studentNumber,fullName:student.fullName,activationToken:raw,row});
 }
 for(let i=0;i<output.length;i+=200){const chunk=output.slice(i,i+200).map(x=>x.row);const {error:ie}=await q.supabase.from("StudentActivationToken").upsert(chunk,{onConflict:"rosterId"});if(ie)throw ie;}
 const csvCell=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
 const csv=["student_number,full_name,activation_token",...output.map(x=>[x.studentNumber,x.fullName,x.activationToken].map(csvCell).join(","))].join("\r\n");
 await audit(q.supabase,q.user.id,"STUDENT_ACTIVATION_TOKENS_EXPORTED","Organization",org.id,{count:output.length});
 s.set("Content-Type","text/csv; charset=utf-8");s.set("Content-Disposition",'attachment; filename="verity-student-activation-tokens.csv"');
 s.send(csv);
}));
app.post("/api/institution/roster/:id/activation-token",auth,run(async(q,s)=>{
 const org=await institutionRosterContext(q.supabase,q.user.id);
 if(!org||org.status!=="APPROVED"||!(await hasApprovedOrganizationCapability(q.supabase,org.id,"ISSUE_CREDENTIALS"))||!(hasInstitutionPermission(org,"roster:manage",q.user.id)||hasInstitutionPermission(org,"registration:recover",q.user.id)))return s.status(403).json({error:"An approved credential issuer owner or authorized ICT recovery officer is required."});
 const {data:student,error}=await q.supabase.from("StudentRoster").select("id,studentNumber,fullName,status,claimedUserId").eq("id",q.params.id).eq("organizationId",org.id).maybeSingle();if(error)throw error;
 if(!student)return s.status(404).json({error:"Student roster record not found."});
 if(student.status!=="ELIGIBLE"||student.claimedUserId)return s.status(409).json({error:"A new activation token cannot be issued for an already claimed, disputed or blocked student record. Use the identity-recovery review process."});
 const raw=crypto.randomBytes(24).toString("base64url"),now=new Date().toISOString();
 const row={id:crypto.randomUUID(),organizationId:org.id,rosterId:student.id,tokenHash:crypto.createHash("sha256").update(raw).digest("hex"),tokenLastFour:raw.slice(-4),issuedBy:q.user.id,createdAt:now,expiresAt:null,usedAt:null,usedBy:null,revokedAt:null};
 const {error:saveError}=await q.supabase.from("StudentActivationToken").upsert(row,{onConflict:"rosterId"});if(saveError)throw saveError;
 await audit(q.supabase,q.user.id,"STUDENT_ACTIVATION_TOKEN_REISSUED","StudentRoster",student.id,{organizationId:org.id});
 s.json({studentNumber:student.studentNumber,fullName:student.fullName,activationToken:raw,message:"A fresh single-use activation token has been issued. Any previous token for this student is now invalid."});
}));
app.get("/api/institution/roster",auth,run(async(q,s)=>{
 const org=await institutionRosterContext(q.supabase,q.user.id);
 if(!org||org.status!=="APPROVED"||!(await hasApprovedOrganizationCapability(q.supabase,org.id,"ISSUE_CREDENTIALS"))||!hasInstitutionPermission(org,"roster:manage",q.user.id))return s.status(403).json({error:"An approved credential issuer owner or authorized ICT roster manager is required."});
 const term=String(q.query.search||"").trim().slice(0,120);
 const {data,error}=await q.supabase.rpc("list_verity_student_roster",{p_organization_id:org.id,p_search:term||null});if(error)throw error;
 s.json(data||{organization:null,students:[],counts:{}});
}));
app.post("/api/institution/roster/import",auth,express.raw({type:["text/csv","text/plain","application/vnd.ms-excel"],limit:"5mb"}),run(async(q,s)=>{
 const org=await institutionRosterContext(q.supabase,q.user.id);
 if(!org||org.status!=="APPROVED"||!(await hasApprovedOrganizationCapability(q.supabase,org.id,"ISSUE_CREDENTIALS"))||!hasInstitutionPermission(org,"roster:manage",q.user.id))return s.status(403).json({error:"An approved credential issuer owner or authorized ICT roster manager is required."});
 if(!Buffer.isBuffer(q.body)||!q.body.length)return s.status(400).json({error:"Upload a non-empty CSV roster file."});
 const fileName=String(q.headers["x-file-name"]||"student-roster.csv").normalize("NFKC").slice(0,180);
 if(!/\.csv$/i.test(fileName))return s.status(415).json({error:"The first roster-import release accepts CSV files. Excel workbook import will be added as a compatible format."});
 const rows=parseRosterCsv(q.body.toString("utf8").replace(/^\uFEFF/,""));
 if(!rows.length)return s.status(400).json({error:"The CSV contains no student records."});
 if(rows.length>10000)return s.status(413).json({error:"A single import is limited to 10,000 student records."});
 const batchId=crypto.randomUUID(),seen=new Set(),valid=[],rejected=[];
 for(let i=0;i<rows.length;i++){
  const r=rows[i],number=String(r.student_number||r.matric_number||"").trim(),name=String(r.full_name||r.student_name||"").trim(),normalized=number.toUpperCase().replace(/\s+/g,"");
  if(number.length<2||number.length>80||name.length<2||name.length>160||!normalized){rejected.push({row:i+2,reason:"Missing or invalid student_number/full_name"});continue;}
  if(seen.has(normalized)){rejected.push({row:i+2,reason:"Duplicate matriculation number in this file"});continue;}
  seen.add(normalized);
  const email=String(r.institutional_email||r.email||"").trim().toLowerCase();
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){rejected.push({row:i+2,reason:"Invalid institutional email"});continue;}
  valid.push({id:crypto.randomUUID(),organizationId:org.id,studentNumber:number,normalizedStudentNumber:normalized,fullName:name,institutionalEmail:email||null,faculty:r.faculty||null,department:r.department||null,programme:r.programme||r.course||null,academicSession:r.academic_session||r.session||null,status:"ELIGIBLE",createdBy:q.user.id,importBatchId:batchId,updatedAt:new Date().toISOString()});
 }
 let inserted=0;
 for(let i=0;i<valid.length;i+=200){
  const chunk=valid.slice(i,i+200);
  const {data,error}=await q.supabase.from("StudentRoster").upsert(chunk,{onConflict:"organizationId,normalizedStudentNumber",ignoreDuplicates:true}).select("id");
  if(error){await q.supabase.from("StudentRoster").delete().eq("organizationId",org.id).eq("importBatchId",batchId);throw error;}
  inserted+=(data||[]).length;
 }
 const rejectedCount=rejected.length+(valid.length-inserted);
 const {error:logError}=await q.supabase.from("StudentRosterImport").insert({id:batchId,organizationId:org.id,uploadedBy:q.user.id,fileName,totalRows:rows.length,insertedRows:inserted,rejectedRows:rejectedCount});
 if(logError)throw logError;
 await audit(q.supabase,q.user.id,"STUDENT_ROSTER_IMPORTED","StudentRosterImport",batchId,{organizationId:org.id,totalRows:rows.length,insertedRows:inserted,rejectedRows:rejectedCount});
 s.status(201).json({batchId,totalRows:rows.length,insertedRows:inserted,rejectedRows:rejectedCount,errors:rejected.slice(0,100),message:"Roster import completed. Existing institution/matriculation records were not overwritten."});
}));

const rosterImportAccess=async(q,s)=>{
 const org=await institutionRosterContext(q.supabase,q.user.id);
 if(!org||org.status!=="APPROVED"||!(await hasApprovedOrganizationCapability(q.supabase,org.id,"ISSUE_CREDENTIALS"))||!hasInstitutionPermission(org,"roster:manage",q.user.id)){
  s.status(403).json({error:"An approved credential issuer owner or authorized ICT roster manager is required."});
  return null;
 }
 return org;
};

app.get("/api/organization/analytics",auth,run(async(q,s)=>{
 const org=await rosterImportAccess(q,s);if(!org)return;
 const {count:totalStudents,error:studentError}=await q.supabase.from("StudentRoster").select("id",{count:"exact",head:true}).eq("organizationId",org.id);
 if(studentError)throw studentError;
 let certificatesIssued=null,activeCertificates=null;
 if(org.ownerId===q.user.id){
  const {count,error}=await q.supabase.from("Certificate").select("id",{count:"exact",head:true}).eq("organizationId",org.id);
  if(error)throw error;certificatesIssued=count??0;
  const {count:active,error:activeError}=await q.supabase.from("Certificate").select("id",{count:"exact",head:true}).eq("organizationId",org.id).eq("status","ACTIVE");
  if(activeError)throw activeError;activeCertificates=active??0;
 }
 s.json({totalStudents:totalStudents??0,certificatesIssued,activeCertificates});
}));

app.get("/api/organization/students",auth,run(async(q,s)=>{
 const org=await rosterImportAccess(q,s);if(!org)return;
 const limit=Math.min(200,Math.max(1,Number.parseInt(q.query.limit,10)||100));
 const offset=Math.min(50000,Math.max(0,Number.parseInt(q.query.offset,10)||0));
 const term=String(q.query.search||"").trim().slice(0,100).replace(/[^\p{L}\p{N}\s\-/]/gu,"");
 let query=q.supabase.from("StudentRoster").select("id,studentNumber,fullName,institutionalEmail,faculty,department,programme,qualification,classification,awardDate,academicSession,status,createdAt",{count:"exact"}).eq("organizationId",org.id).order("createdAt",{ascending:false}).range(offset,offset+limit-1);
 if(term)query=query.or("studentNumber.ilike.%"+term+"%,fullName.ilike.%"+term+"%,department.ilike.%"+term+"%,faculty.ilike.%"+term+"%");
 const {data,error,count}=await query;if(error)throw error;
 s.json({students:data||[],total:count??0,limit,offset});
}));

app.get("/api/organization/students/import-batches",auth,run(async(q,s)=>{
 const org=await rosterImportAccess(q,s);if(!org)return;
 const {data,error}=await q.supabase.from("StudentRosterImport").select("id,fileName,totalRows,totalChunks,processedChunks,failedChunks,insertedRows,duplicateRows,rejectedRows,status,errorSummary,createdAt,updatedAt,completedAt").eq("organizationId",org.id).order("createdAt",{ascending:false}).limit(30);
 if(error)throw error;
 s.json({batches:data||[],workerEnabled:STUDENT_IMPORT_WORKER_ENABLED});
}));

app.post("/api/organization/students/import-batches",auth,run(async(q,s)=>{
 const org=await rosterImportAccess(q,s);if(!org)return;
 const body=z.object({
  fileName:z.string().trim().min(1).max(180),
  totalRows:z.number().int().min(1).max(50000),
  totalChunks:z.number().int().min(1).max(500),
  rejectedRows:z.number().int().min(0).max(50000),
  errorSummary:z.array(z.object({rowNumber:z.number().int().min(0),message:z.string().trim().min(1).max(300)})).max(50).default([])
 }).parse(q.body);
 if(body.rejectedRows>body.totalRows)return s.status(400).json({error:"Rejected rows cannot exceed the uploaded row count."});
 const validRows=body.totalRows-body.rejectedRows;
 const expectedChunks=Math.ceil(validRows/100);
 if(validRows<1||body.totalChunks!==expectedChunks)return s.status(400).json({error:"The batch row and chunk counts do not match. Recheck the CSV preview and try again."});
 const id=crypto.randomUUID(),fileName=body.fileName.replace(/[\\/]/g,"_");
 const {data,error}=await q.supabase.from("StudentRosterImport").insert({
  id,organizationId:org.id,uploadedBy:q.user.id,fileName,totalRows:body.totalRows,
  insertedRows:0,duplicateRows:0,rejectedRows:body.rejectedRows,totalChunks:body.totalChunks,
  processedChunks:0,failedChunks:0,status:"UPLOADING",errorSummary:body.errorSummary,
  updatedAt:new Date().toISOString()
 }).select("id,fileName,totalRows,totalChunks,rejectedRows,status,createdAt").single();
 if(error)throw error;
 await audit(q.supabase,q.user.id,"STUDENT_ROSTER_IMPORT_STAGED","StudentRosterImport",id,{organizationId:org.id,totalRows:body.totalRows,totalChunks:body.totalChunks,rejectedRows:body.rejectedRows});
 s.status(201).json({batch:data});
}));

app.post("/api/organization/students/import-batches/:id/chunks",auth,run(async(q,s)=>{
 const org=await rosterImportAccess(q,s);if(!org)return;
 const rowSchema=z.object({
  studentNumber:z.string().trim().min(2).max(80),
  fullName:z.string().trim().min(2).max(160),
  email:z.string().trim().max(254).optional().default(""),
  faculty:z.string().trim().min(2).max(160),
  department:z.string().trim().min(2).max(160),
  programme:z.string().trim().min(2).max(180),
  qualification:z.string().trim().min(2).max(180),
  classification:z.string().trim().max(100).optional().default(""),
  awardDate:z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).nullable().optional(),
  academicSession:z.string().trim().max(80).optional().default("")
 });
 const body=z.object({chunkIndex:z.number().int().min(0).max(499),rows:z.array(rowSchema).min(1).max(100)}).parse(q.body);
 const normalizedRows=body.rows.map(row=>({
  studentNumber:row.studentNumber,fullName:row.fullName,email:row.email.toLowerCase(),
  faculty:row.faculty,department:row.department,programme:row.programme,qualification:row.qualification,
  classification:row.classification||"",awardDate:row.awardDate||null,academicSession:row.academicSession||""
 }));
 for(const row of normalizedRows){
  if(row.email&&(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(row.email)||row.email.length>254))return s.status(400).json({error:"One or more student email addresses are invalid."});
  if(row.awardDate){const d=new Date(row.awardDate+"T00:00:00.000Z");if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==row.awardDate)return s.status(400).json({error:"Award dates must be real calendar dates in YYYY-MM-DD format."});}
 }
 const {data:batch,error:batchError}=await q.supabase.from("StudentRosterImport").select("id,organizationId,uploadedBy,totalRows,rejectedRows,totalChunks,status").eq("id",q.params.id).eq("organizationId",org.id).maybeSingle();
 if(batchError)throw batchError;
 if(!batch)return s.status(404).json({error:"Import batch not found."});
 if(batch.uploadedBy!==q.user.id||batch.status!=="UPLOADING")return s.status(409).json({error:"This import batch is no longer accepting chunks."});
 const expectedRows=Math.min(100,batch.totalRows-batch.rejectedRows-(body.chunkIndex*100));
 if(body.chunkIndex>=batch.totalChunks||expectedRows!==normalizedRows.length)return s.status(400).json({error:"The chunk index or row count does not match the batch manifest."});
 const contentHash=digest(JSON.stringify(normalizedRows));
 const {error:insertError}=await q.supabase.from("StudentImportChunk").insert({
  batchId:batch.id,organizationId:org.id,chunkIndex:body.chunkIndex,rows:normalizedRows,
  contentHash,createdBy:q.user.id
 });
 if(insertError&&insertError.code==="23505"){
  const {data:existing,error:existingError}=await q.supabase.from("StudentImportChunk").select("contentHash").eq("batchId",batch.id).eq("chunkIndex",body.chunkIndex).maybeSingle();
  if(existingError)throw existingError;
  if(existing?.contentHash!==contentHash)return s.status(409).json({error:"A different payload is already staged for this chunk. Start a new import batch."});
  return s.json({staged:true,alreadyStaged:true,chunkIndex:body.chunkIndex});
 }
 if(insertError)throw insertError;
 s.status(201).json({staged:true,chunkIndex:body.chunkIndex,rows:normalizedRows.length});
}));

app.post("/api/organization/students/import-batches/:id/complete",auth,run(async(q,s)=>{
 const org=await rosterImportAccess(q,s);if(!org)return;
 const {data:batch,error}=await q.supabase.from("StudentRosterImport").select("id,organizationId,uploadedBy,totalChunks,status").eq("id",q.params.id).eq("organizationId",org.id).maybeSingle();
 if(error)throw error;
 if(!batch)return s.status(404).json({error:"Import batch not found."});
 if(batch.uploadedBy!==q.user.id)return s.status(403).json({error:"Only the person who created this import batch can submit it."});if(batch.status!=="UPLOADING"){if(["QUEUED","PROCESSING","COMPLETED","PARTIAL","FAILED"].includes(batch.status))return s.json({batch:{id:batch.id,status:batch.status},workerEnabled:STUDENT_IMPORT_WORKER_ENABLED,alreadySubmitted:true});return s.status(409).json({error:"This import batch cannot be submitted in its current state."});}
 const {data:chunks,error:chunkError}=await q.supabase.from("StudentImportChunk").select("chunkIndex").eq("batchId",batch.id).eq("organizationId",org.id);
 if(chunkError)throw chunkError;
 const indexes=new Set((chunks||[]).map(x=>x.chunkIndex));
 if(indexes.size!==batch.totalChunks||Array.from({length:batch.totalChunks},(_,i)=>i).some(i=>!indexes.has(i)))return s.status(409).json({error:"Some import chunks have not finished uploading. Retry the missing chunk before submitting the batch."});
 const {data:queued,error:queueError}=await q.supabase.from("StudentRosterImport").update({status:"QUEUED",updatedAt:new Date().toISOString()}).eq("id",batch.id).eq("status","UPLOADING").select("id,status").maybeSingle();
 if(queueError)throw queueError;
 if(!queued)return s.status(409).json({error:"The batch was already submitted or changed state."});
 await audit(q.supabase,q.user.id,"STUDENT_ROSTER_IMPORT_QUEUED","StudentRosterImport",batch.id,{organizationId:org.id,totalChunks:batch.totalChunks});
 s.json({batch:queued,workerEnabled:STUDENT_IMPORT_WORKER_ENABLED,message:STUDENT_IMPORT_WORKER_ENABLED?"The import is queued for background processing.":"The import is safely queued; background processing must be enabled by the deployment operator."});
}));

app.get("/api/institution/ict",auth,run(async(q,s)=>{
 const org=await institutionRosterContext(q.supabase,q.user.id);
 if(!org||org.type!=="INSTITUTION"||org.ownerId!==q.user.id)return s.status(403).json({error:"Only the institution owner can manage ICT assignments."});
 const {data,error}=await q.supabase.from("InstitutionICTStaff").select("id,userId,permissions,status,createdAt").eq("organizationId",org.id).order("createdAt",{ascending:false});if(error)throw error;
 const ids=(data||[]).map(x=>x.userId);
 const {data:users,error:ue}=ids.length?await q.supabase.from("User").select("id,fullName,email,role").in("id",ids):{data:[],error:null};if(ue)throw ue;
 s.json({staff:(data||[]).map(x=>({...x,user:(users||[]).find(u=>u.id===x.userId)||null}))});
}));
app.post("/api/institution/ict",auth,run(async(q,s)=>{
 const b=z.object({email:z.string().email(),permissions:z.array(z.enum(["roster:manage","registration:recover"])).min(1).max(2)}).parse(q.body);
 const {data:org,error}=await q.supabase.from("Organization").select("id,status,type").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;
 if(!org||org.status!=="APPROVED"||org.type!=="INSTITUTION")return s.status(403).json({error:"Only an approved institution owner can appoint ICT officers."});
 const {data:person,error:pe}=await q.supabase.from("User").select("id,email,role").ilike("email",b.email.trim()).maybeSingle();if(pe)throw pe;
 if(!person||person.id===q.user.id||person.role!=="GRADUATE")return s.status(404).json({error:"The ICT officer must already have a Graduate account in VERITY."});
 const {data,error:saveError}=await q.supabase.from("InstitutionICTStaff").upsert({id:crypto.randomUUID(),organizationId:org.id,userId:person.id,permissions:[...new Set(b.permissions)],status:"ACTIVE",createdBy:q.user.id,updatedAt:new Date().toISOString()},{onConflict:"organizationId,userId"}).select().single();if(saveError)throw saveError;
 await audit(q.supabase,q.user.id,"INSTITUTION_ICT_ASSIGNED","InstitutionICTStaff",data.id,{organizationId:org.id,permissions:data.permissions});
 s.status(201).json({staff:data});
}));
app.patch("/api/institution/ict/:id",auth,run(async(q,s)=>{
 const b=z.object({status:z.enum(["ACTIVE","SUSPENDED"]),permissions:z.array(z.enum(["roster:manage","registration:recover"])).min(1).max(2).optional()}).parse(q.body);
 const {data:org,error}=await q.supabase.from("Organization").select("id,status,type").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;
 if(!org||org.type!=="INSTITUTION")return s.status(403).json({error:"Only the institution owner can change ICT privileges."});
 const patch={status:b.status,updatedAt:new Date().toISOString()};if(b.permissions)patch.permissions=[...new Set(b.permissions)];
 const {data,error:saveError}=await q.supabase.from("InstitutionICTStaff").update(patch).eq("id",q.params.id).eq("organizationId",org.id).select().single();if(saveError)throw saveError;
 await audit(q.supabase,q.user.id,"INSTITUTION_ICT_"+b.status,"InstitutionICTStaff",data.id,{organizationId:org.id,permissions:data.permissions});
 s.json({staff:data});
}));
app.get("/api/institution/recoveries",auth,run(async(q,s)=>{
 const org=await institutionRosterContext(q.supabase,q.user.id);
 if(!org||org.type!=="INSTITUTION"||org.status!=="APPROVED"||!hasInstitutionPermission(org,"registration:recover",q.user.id))return s.status(403).json({error:"An authorized institution owner or ICT recovery officer is required."});
 const {data,error}=await q.supabase.rpc("list_verity_student_recovery_cases",{p_organization_id:org.id});if(error)throw error;
 s.json({recoveries:Array.isArray(data)?data:[]});
}));
app.post("/api/institution/recoveries",auth,run(async(q,s)=>{
 const b=z.object({studentNumber:z.string().min(2).max(80),reason:z.string().trim().min(10).max(1000)}).parse(q.body);
 const org=await institutionRosterContext(q.supabase,q.user.id);
 if(!org||org.type!=="INSTITUTION"||org.status!=="APPROVED"||!hasInstitutionPermission(org,"registration:recover",q.user.id))return s.status(403).json({error:"An authorized institution owner or ICT recovery officer is required."});
 const normalized=b.studentNumber.trim().toUpperCase().replace(/\s+/g,"");
 const {data:roster,error:re}=await q.supabase.from("StudentRoster").select("id,status").eq("organizationId",org.id).eq("normalizedStudentNumber",normalized).maybeSingle();if(re)throw re;
 if(!roster)return s.status(404).json({error:"No matching roster record was found. Check the number against official institution records."});
 const {data,error}=await q.supabase.from("StudentRegistrationRecovery").insert({id:crypto.randomUUID(),organizationId:org.id,rosterId:roster.id,reportedBy:q.user.id,reason:b.reason}).select().single();if(error)throw error;
 const {error:flagError}=await q.supabase.from("StudentRoster").update({status:"DISPUTED",updatedAt:new Date().toISOString()}).eq("id",roster.id).eq("organizationId",org.id);if(flagError)throw flagError;
 await audit(q.supabase,q.user.id,"STUDENT_REGISTRATION_DISPUTE_OPENED","StudentRegistrationRecovery",data.id,{organizationId:org.id,rosterId:roster.id});
 s.status(201).json({recovery:data,message:"A registration dispute has been opened. The existing account has not been transferred or deleted."});
}));

app.patch("/api/institution/recoveries/:id/review",auth,run(async(q,s)=>{
 const b=z.object({decision:z.enum(["APPROVED","REJECTED"]),notes:z.string().trim().min(10).max(1000)}).parse(q.body);
 const org=await institutionRosterContext(q.supabase,q.user.id);
 if(!org||org.type!=="INSTITUTION"||org.status!=="APPROVED"||!hasInstitutionPermission(org,"registration:recover",q.user.id))return s.status(403).json({error:"An authorized institution recovery officer is required."});
 const {data,error}=await q.supabase.rpc("review_verity_student_recovery",{p_recovery_id:q.params.id,p_decision:b.decision,p_notes:b.notes});
 if(error)return s.status(400).json({error:error.message});
 await audit(q.supabase,q.user.id,"STUDENT_REGISTRATION_RECOVERY_"+b.decision,"StudentRegistrationRecovery",q.params.id,{organizationId:org.id,notes:b.notes});
 s.json({recovery:data,message:b.decision==="APPROVED"?"First review recorded. A different authorized officer must provide the second approval.":"The dispute was rejected and the roster record restored to its prior claim state."});
}));
app.post("/api/institution/recoveries/:id/complete",auth,run(async(q,s)=>{
 const b=z.object({notes:z.string().trim().min(10).max(1000)}).parse(q.body);
 const org=await institutionRosterContext(q.supabase,q.user.id);
 if(!org||org.type!=="INSTITUTION"||org.status!=="APPROVED"||!hasInstitutionPermission(org,"registration:recover",q.user.id))return s.status(403).json({error:"An authorized institution recovery officer is required."});
 const {data,error}=await q.supabase.rpc("complete_verity_student_recovery",{p_recovery_id:q.params.id,p_notes:b.notes});
 if(error)return s.status(409).json({error:error.message});
 const raw=crypto.randomBytes(24).toString("base64url"),now=new Date().toISOString();
 const tokenRow={id:crypto.randomUUID(),organizationId:org.id,rosterId:data.rosterId,tokenHash:crypto.createHash("sha256").update(raw).digest("hex"),tokenLastFour:raw.slice(-4),issuedBy:q.user.id,createdAt:now,expiresAt:null,usedAt:null,usedBy:null,revokedAt:null};
 const {error:tokenError}=await q.supabase.from("StudentActivationToken").upsert(tokenRow,{onConflict:"rosterId"});
 if(tokenError)return s.status(200).json({recovery:data,activationToken:null,message:"Two-person recovery completed. The roster is eligible again, but token creation needs to be retried by an authorized ICT officer."});
 await audit(q.supabase,q.user.id,"STUDENT_REGISTRATION_RECOVERY_COMPLETED","StudentRegistrationRecovery",q.params.id,{organizationId:org.id,rosterId:data.rosterId,previousClaimantId:data.claimedUserId});
 if(data.claimedUserId)await createVerityNotification(data.claimedUserId,{type:"STUDENT_REGISTRATION_CLAIM_RELEASED",category:"ACCOUNT",title:"Institution student-record review completed",body:"Your institution completed a two-person review of a disputed student registration. Contact the institution if you believe this was an error.",url:"/join",metadata:{organizationId:org.id,recoveryId:q.params.id}});
 s.json({recovery:data,activationToken:raw,message:"Two-person recovery completed. The old unused claim was released and a fresh single-use token is ready for the verified student."});
}));
app.get("/api/organization/members",auth,roles("EMPLOYER"),run(async(q,s)=>{const {data:org,error}=await q.supabase.from("Organization").select("id,status").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;if(!org)return s.json({members:[]});if(org.status!=="APPROVED"||!(await hasApprovedOrganizationCapability(q.supabase,org.id,"ISSUE_CREDENTIALS")))return s.status(403).json({error:"Only an approved credential issuer can manage its graduate and employee memberships."});const {data,error:e}=await q.supabase.from("Membership").select("id,userId,studentNumber,status,createdAt").eq("organizationId",org.id).order("createdAt",{ascending:false});if(e)throw e;const ids=(data||[]).map(x=>x.userId);const {data:people,error:pe}=ids.length?await q.supabase.from("User").select("id,fullName,email,institution").in("id",ids):{data:[],error:null};if(pe)throw pe;s.json({members:(data||[]).map(m=>({...m,user:(people||[]).find(p=>p.id===m.userId)||null}))});}));
app.patch("/api/organization/members/:id",auth,roles("EMPLOYER"),run(async(q,s)=>{const b=z.object({status:z.enum(["ACTIVE","REJECTED"])}).parse(q.body);const {data:org,error}=await q.supabase.from("Organization").select("id,status,name,type").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;if(!org||org.status!=="APPROVED"||!(await hasApprovedOrganizationCapability(q.supabase,org.id,"ISSUE_CREDENTIALS")))return s.status(403).json({error:"Only an approved credential issuer can manage its graduate and employee memberships."});const {data:errorRow,error:e}=await q.supabase.from("Membership").select("id,userId,studentNumber").eq("id",q.params.id).eq("organizationId",org.id).single();if(e)throw e;const {data,error:updateError}=await q.supabase.from("Membership").update({status:b.status,updatedAt:new Date().toISOString()}).eq("id",q.params.id).eq("organizationId",org.id).select().single();if(updateError)throw updateError;if(b.status==="ACTIVE"){const {data:student}=await q.supabase.from("User").select("email").eq("id",errorRow.userId).maybeSingle();if(student?.email){const {error:certError}=await q.supabase.from("Certificate").update({graduateId:errorRow.userId,organizationId:org.id,updatedAt:new Date().toISOString()}).eq("studentEmail",student.email).eq("institution",org.name);if(certError)throw certError;}}await audit(q.supabase,q.user.id,"STUDENT_MEMBERSHIP_"+b.status,"Membership",data.id,{organizationId:org.id});s.json({membership:data});}));
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
 const {data:e,error}=await q.supabase.from("OrganizationEvidence").select("id,organizationId,storagePath,originalName,mimeType,sha256,scanStatus").eq("id",q.params.evidenceId).eq("organizationId",q.params.id).maybeSingle();if(error)throw error;if(!e)return s.status(404).json({error:"Evidence not found."});
  const {data:file,error:fe}=await q.supabase.storage.from("verity-organization-evidence").download(e.storagePath);if(fe)throw fe;
  const evidenceBytes=Buffer.from(await file.arrayBuffer());
  if(!e.sha256||digest(evidenceBytes)!==e.sha256)return s.status(409).json({error:"Evidence integrity check failed. The stored file does not match its registered SHA-256 fingerprint."});
  const {data:link,error:le}=await q.supabase.storage.from("verity-organization-evidence").createSignedUrl(e.storagePath,60);if(le)throw le;
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
  const {data:stored,error:storageError}=await q.supabase.storage.from("verity-certificates").download(doc.storagePath);
  if(storageError)throw storageError;
  const storedBytes=Buffer.from(await stored.arrayBuffer());
  if(!doc.sha256||digest(storedBytes)!==doc.sha256)return res.status(409).json({error:"Document integrity check failed. The stored file does not match its registered SHA-256 fingerprint."});
  const {data:link,error:le}=await q.supabase.storage.from("verity-certificates").createSignedUrl(doc.storagePath,60);
  if(le)throw le;
  await audit(q.supabase,q.user.id,"ADMIN_CERTIFICATE_DOCUMENT_PREVIEWED","CertificateDocument",doc.id,{certificateId:cert.certificateId,scanStatus:doc.scanStatus});
  res.json({url:link.signedUrl,mimeType:doc.mimeType,originalName:doc.originalName,student:cert,expiresIn:60});
}));

app.get("/api/admin/organizations",auth,roles("ADMIN"),run(async(q,s)=>{const {data,error}=await q.supabase.from("Organization").select("*").order("createdAt",{ascending:false});if(error)throw error;const ids=(data||[]).map(o=>o.id);const {data:evidence,error:ee}=ids.length?await q.supabase.from("OrganizationEvidence").select("id,organizationId,evidenceType,originalName,scanStatus,createdAt").in("organizationId",ids).order("createdAt",{ascending:false}):{data:[],error:null};if(ee)throw ee;s.json({organizations:(data||[]).map(o=>({...o,evidence:(evidence||[]).filter(e=>e.organizationId===o.id)}))});}));
app.patch("/api/admin/organizations/:id",auth,roles("ADMIN"),run(async(q,s)=>{
 const b=z.object({status:z.enum(["APPROVED","SUSPENDED"]),verificationNotes:z.string().max(1000).optional()}).parse(q.body);
 const {data:org,error:oe}=await q.supabase.from("Organization").select("id,name,type,educationLevels,registrationNumber,officialWebsite,officialEmailDomain,accreditationBody").eq("id",q.params.id).maybeSingle();if(oe)throw oe;if(!org)return s.status(404).json({error:"Organization not found."});
 if(b.status==="APPROVED"){
   const requiresTertiaryEvidence=org.type==="INSTITUTION"&&(org.educationLevels||[]).includes("TERTIARY");if(org.type==="INSTITUTION"&&(!org.registrationNumber||!org.accreditationBody||(requiresTertiaryEvidence&&!org.officialWebsite)))return s.status(400).json({error:requiresTertiaryEvidence?"Tertiary institution approval requires its registration number, official website and accreditation body.":"Primary/secondary school approval requires its official school registration number and supervising or accreditation body."});
   const {data:evidence,error:ee}=await q.supabase.from("OrganizationEvidence").select("id,evidenceType").eq("organizationId",org.id).limit(1);if(ee)throw ee;
   if(!evidence?.length)return s.status(400).json({error:"Review at least one official registration or accreditation evidence document before approval."});
 }
 const patch={status:b.status,updatedAt:new Date().toISOString(),verificationNotes:b.verificationNotes||null,verifiedAt:b.status==="APPROVED"?new Date().toISOString():null,verifiedBy:b.status==="APPROVED"?q.user.id:null};
 const {data,error}=await q.supabase.from("Organization").update(patch).eq("id",q.params.id).select().single();if(error)throw error;
 let preservedBaselineCapability=null;
 if(b.status==="APPROVED"){
   const legacyBaseline="Existing organization capability preserved during additive VERITY expansion.";
   const defaultCapability=org.type==="INSTITUTION"?"ISSUE_CREDENTIALS":org.type==="EMPLOYER"?"VERIFY_CREDENTIALS":null;
   if(defaultCapability){
     const {error:capabilityError}=await q.supabase.from("OrganizationCapability").update({status:"APPROVED",reviewedBy:q.user.id,reviewedAt:new Date().toISOString(),decisionNote:"Legacy baseline capability preserved after the existing organization identity was approved.",updatedAt:new Date().toISOString()})
       .eq("organizationId",org.id).eq("capability",defaultCapability).eq("status","PENDING").eq("requestNote",legacyBaseline);
     if(capabilityError)throw capabilityError;
     preservedBaselineCapability=defaultCapability;
   }
 }
 await audit(q.supabase,q.user.id,"ORGANIZATION_"+b.status,"Organization",data.id,{organizationId:data.id,verificationNotes:b.verificationNotes||null,preservedBaselineCapability});
 const {data:owner}=await q.supabase.from("Organization").select("ownerId,name").eq("id",data.id).maybeSingle();
 if(owner?.ownerId)await createVerityNotification(owner.ownerId,{type:"ORGANIZATION_STATUS",category:"ACCOUNT",title:b.status==="APPROVED"?"Organization approved":"Organization status updated",body:b.status==="APPROVED"?data.name+" has been approved on VERITY.":"The status of "+data.name+" has changed to "+b.status+".",url:"/identity",metadata:{organizationId:data.id,status:b.status}});
 s.json({organization:data});
}));

app.get("/api/dashboard",auth,run(async(q,s)=>{
  const admin=q.user.role==="ADMIN", graduate=q.user.role==="GRADUATE";
  const {data:ownedOrg,error:orgError}=q.user.role==="EMPLOYER"?await q.supabase.from("Organization").select("id,status,name,type,registrationCode,educationLevels").eq("ownerId",q.user.id).maybeSingle():{data:null,error:null};
  if(orgError)throw orgError;
  const ownedCapabilities=ownedOrg?await organizationCapabilities(q.supabase,ownedOrg.id):[];
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
  s.json({stats:{total:total.count||0,active:active.count||0,revoked:revoked.count||0,verifications:verifications.count||0},recent:recent.data||[],recentChecks:recentChecks.data||[],organization:ownedOrg?{...ownedOrg,capabilities:ownedCapabilities}:null,blockchain:chainStatus(),generatedAt:new Date().toISOString()});
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
  const b=issue.parse(q.body); let organization=null;if(q.user.role==="EMPLOYER"){const {data,error}=await q.supabase.from("Organization").select("*").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;organization=data;if(!organization||organization.status!=="APPROVED")return s.status(403).json({error:"Your organization must be approved by the Verity System Admin before issuing certificates."});if(!(await hasApprovedOrganizationCapability(q.supabase,organization.id,"ISSUE_CREDENTIALS")))return s.status(403).json({error:"Your organization does not have an approved credential-issuance capability."});}
  const certificateId=`VRT-${new Date().getFullYear()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const verificationKey=`VRT-${crypto.randomBytes(16).toString("hex").toUpperCase()}`;
  const clean=Object.fromEntries(Object.entries(b).map(([k,v])=>[k,typeof v==="string"?v.trim():v]));
  if(organization) clean.institution=organization.name;
  const hash=digest(canonical({...clean,certificateId}));
  let graduateId=null;
  if(clean.studentEmail){
    const {data:graduate,error:gError}=await q.supabase.from("User").select("id").eq("email",clean.studentEmail.toLowerCase()).maybeSingle();
    if(gError) throw gError;
    graduateId=graduate?.id||null;
  }
  const now=new Date().toISOString();
  const record={...clean,id:crypto.randomUUID(),studentEmail:clean.studentEmail||null,certificateId,verificationKey,organizationId:organization?.id||null,digest:hash,awardDate:new Date(clean.awardDate).toISOString(),issuerId:q.user.id,graduateId,txHash:null,chainId:null,contractAddress:null,createdAt:now,updatedAt:now,issuedAt:now};
  // Persist first: the PostgreSQL trigger appends the ISSUED ledger event in
  // the same transaction. Optional blockchain anchoring must never prevent
  // the authoritative Supabase credential from being issued.
  const {data:created,error}=await q.supabase.from("Certificate").insert(record).select().single();
  if(error) throw error;
  let generatedDocument=null,documentGenerationWarning=null;
  if(organization){
    try{
      const {data:template,error:templateError}=await q.supabase.from("InstitutionCertificateTemplate")
        .select("id,name,sourceType,templateKey,assetStoragePath,assetMimeType,assetSha256,pageSize,fieldLayout")
        .eq("organizationId",organization.id).eq("status","ACTIVE").eq("isDefault",true).maybeSingle();
      if(templateError)throw templateError;
      if(template){
        let artworkBytes=null;
        if(template.sourceType==="INSTITUTION_ARTWORK"){
          const {data:file,error:fileError}=await q.supabase.storage.from("verity-certificates").download(template.assetStoragePath);
          if(fileError)throw fileError;
          artworkBytes=Buffer.from(await file.arrayBuffer());
          if(!template.assetSha256||digest(artworkBytes)!==template.assetSha256)throw new Error("Active certificate artwork failed its SHA-256 integrity check.");
        }
        const verificationUrl=`${process.env.PUBLIC_APP_URL||q.protocol+"://"+q.get("host")}/verify/${encodeURIComponent(verificationKey)}`;
        const pdf=await renderCertificateDocument({
          template:{...template,fieldLayout:validateFieldLayout(template.fieldLayout||{})},
          organizationName:organization.name,
          data:{...clean,certificateId},
          artworkBytes,verificationUrl,preview:false
        });
        const documentId=crypto.randomUUID(),storagePath=`${organization.id}/${created.id}/${documentId}.pdf`,sha256=digest(pdf);
        const {error:uploadError}=await q.supabase.storage.from("verity-certificates").upload(storagePath,pdf,{contentType:"application/pdf",upsert:false,cacheControl:"3600"});
        if(uploadError)throw uploadError;
        const {data:doc,error:docError}=await q.supabase.from("CertificateDocument").insert({
          id:documentId,certificateId:created.id,organizationId:organization.id,storagePath,
          originalName:`VERITY-${certificateId}.pdf`,mimeType:"application/pdf",sizeBytes:pdf.length,
          sha256,uploadedBy:q.user.id,scanStatus:"NOT_SCANNED"
        }).select("id,originalName,mimeType,sizeBytes,sha256,scanStatus,createdAt").single();
        if(docError){await q.supabase.storage.from("verity-certificates").remove([storagePath]);throw docError;}
        generatedDocument=doc;
        await audit(q.supabase,q.user.id,"CERTIFICATE_DOCUMENT_GENERATED","CertificateDocument",doc.id,{certificateId,organizationId:organization.id,templateId:template.id,sha256,source:"APPROVED_TEMPLATE"});
      }
    }catch(renderError){
      documentGenerationWarning=String(renderError?.message||"Certificate PDF generation failed").slice(0,300);
      console.error("Certificate credential was issued, but its approved-design PDF could not be generated:",renderError);
    }
  }
  let chain={mode:"SUPABASE_LEDGER"},certificate=created,blockchainAnchorPending=false;
  try{
    chain=await issueOnChain(certificateId,hash);
    if(chain.txHash){
      const {data:anchored,error:anchorError}=await q.supabase.from("Certificate").update({txHash:chain.txHash,chainId:chain.chainId,contractAddress:chain.contractAddress,updatedAt:new Date().toISOString()}).eq("id",created.id).select().single();
      if(anchorError)throw anchorError;
      certificate=anchored;
    }
  }catch(anchorError){
    blockchainAnchorPending=true;
    console.error("Optional blockchain issuance anchor failed; Supabase ledger remains authoritative:",anchorError);
    chain={mode:"SUPABASE_LEDGER"};
  }
  await audit(q.supabase,q.user.id,"CERTIFICATE_ISSUED","Certificate",certificate.id,{certificateId,mode:chain.mode||"SUPABASE_LEDGER",blockchainAnchorPending,organizationId:organization?.id||null});
  if(graduateId)await createVerityNotification(graduateId,{type:"CERTIFICATE_ISSUED",category:"CERTIFICATE",title:"A new certificate is available",body:"A certificate from "+clean.institution+" has been added to your VERITY account.",url:"/certificates",metadata:{certificateId}});
  await notifyVerityAdmins({type:"CERTIFICATE_ISSUED",category:"PLATFORM",title:"Certificate issued",body:certificateId+" was issued by "+(organization?.name||clean.institution)+".",url:"/certificates",metadata:{certificateId}});
  s.status(201).json({certificate,document:generatedDocument,documentGenerationWarning,chainMode:chain.mode||"SUPABASE_LEDGER",blockchainAnchorPending});
}));


// Durable bulk certificate issuance: institution owners stage private PDFs and
// immutable certificate payloads; the in-process worker writes the Supabase ledger.
async function bulkInstitutionFor(q,requireApproved=true){
  const {data:org,error}=await q.supabase.from("Organization")
    .select("id,name,type,status,ownerId").eq("ownerId",q.user.id).maybeSingle();
  if(error)throw error;
  if(!org)return {error:"Institution organization not found.",status:404};
  if(requireApproved&&org.status!=="APPROVED")return {error:"Your organization must be approved before bulk certificate issuance.",status:403};
  if(!(await hasApprovedOrganizationCapability(q.supabase,org.id,"ISSUE_CREDENTIALS")))return {error:"Your organization does not have an approved credential-issuance capability.",status:403};
  return {organization:org};
}
const bulkCampaignInput=z.object({
  fileName:z.string().trim().min(1).max(180),
  method:z.enum(["CSV_ZIP","CSV_MULTIPLE_PDFS","CSV_GENERATED"]),
  totalItems:z.number().int().min(1).max(50000)
});
const bulkBatchInput=z.object({
  fileName:z.string().trim().min(1).max(180),
  method:z.enum(["CSV_ZIP","CSV_MULTIPLE_PDFS","CSV_GENERATED"]),
  totalItems:z.number().int().min(1).max(500),
  campaignId:z.string().uuid().optional()
});
const bulkItemInput=z.object({
  itemId:z.string().uuid(),
  rowNumber:z.number().int().min(2),
  payload:issue,
  documentName:z.string().trim().min(1).max(180).optional(),
  documentSha256:z.string().regex(/^[a-f0-9]{64}$/).optional()
});
const bulkSafeName=value=>String(value||"certificate.pdf").normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,120)||"certificate.pdf";
const bulkWorkerReady=()=>BULK_CERTIFICATE_WORKER_ENABLED;

app.post("/api/organization/certificates/bulk/campaigns",auth,roles("EMPLOYER"),run(async(q,s)=>{
  const result=await bulkInstitutionFor(q,true);if(result.error)return s.status(result.status).json({error:result.error});
  if(!SUPABASE_SERVER_KEY)return s.status(503).json({error:"Durable bulk issuance is not configured. Add a server-only Supabase service key in Render."});
  if(!BULK_CERTIFICATE_WORKER_ENABLED)return s.status(503).json({error:"The bulk certificate worker is not enabled yet. Contact the VERITY administrator before submitting a campaign."});
  const campaign=bulkCampaignInput.parse(q.body),server=makeServerClient(),id=crypto.randomUUID();
  const {data,error}=await server.from("CertificateIssuanceCampaign").insert({
    id,organizationId:result.organization.id,createdBy:q.user.id,fileName:bulkSafeName(campaign.fileName),
    method:campaign.method,totalItems:campaign.totalItems
  }).select("id,organizationId,fileName,method,totalItems,createdAt").single();
  if(error)throw error;
  s.status(201).json({campaign:data,workerEnabled:true,processingBatchSize:500});
}));

app.get("/api/organization/certificates/bulk/campaigns",auth,roles("EMPLOYER"),run(async(q,s)=>{
  const result=await bulkInstitutionFor(q,false);if(result.error)return s.status(result.status).json({error:result.error});
  const {data:campaigns,error}=await q.supabase.from("CertificateIssuanceCampaign")
    .select("id,fileName,method,totalItems,createdAt,updatedAt")
    .eq("organizationId",result.organization.id).order("createdAt",{ascending:false}).limit(25);
  if(error)throw error;
  const ids=(campaigns||[]).map(x=>x.id);
  let batches=[];
  if(ids.length){
    const response=await q.supabase.from("CertificateIssuanceBatch")
      .select("id,campaignId,fileName,totalItems,queuedItems,processingItems,issuedItems,failedItems,documentFailedItems,status,createdAt,completedAt")
      .in("campaignId",ids).order("createdAt",{ascending:true});
    if(response.error)throw response.error;
    batches=response.data||[];
  }
  const grouped=new Map();
  for(const batch of batches){const list=grouped.get(batch.campaignId)||[];list.push(batch);grouped.set(batch.campaignId,list);}
  s.json({campaigns:(campaigns||[]).map(campaign=>{
    const parts=grouped.get(campaign.id)||[];
    const sum=key=>parts.reduce((total,b)=>total+Number(b[key]||0),0);
    const allocated=parts.reduce((total,b)=>total+Number(b.totalItems||0),0);
    const terminal=parts.length>0&&parts.length===Math.ceil(campaign.totalItems/500)&&parts.every(b=>["COMPLETED","PARTIAL","FAILED","CANCELLED"].includes(b.status));
    return {...campaign,allocatedItems:allocated,queuedItems:sum("queuedItems"),processingItems:sum("processingItems"),issuedItems:sum("issuedItems"),failedItems:sum("failedItems"),documentFailedItems:sum("documentFailedItems"),processingBatches:parts.length,status:terminal?(sum("failedItems")||sum("documentFailedItems")?"PARTIAL":"COMPLETED"):parts.some(b=>["QUEUED","PROCESSING"].includes(b.status))?"PROCESSING":"UPLOADING",batches:parts};
  }),workerEnabled:bulkWorkerReady(),processingBatchSize:500});
}));

app.get("/api/organization/certificates/bulk/batches",auth,roles("EMPLOYER"),run(async(q,s)=>{
  const result=await bulkInstitutionFor(q,false);if(result.error)return s.status(result.status).json({error:result.error});
  const {data,error}=await q.supabase.from("CertificateIssuanceBatch")
    .select("id,fileName,method,totalItems,queuedItems,processingItems,issuedItems,failedItems,documentFailedItems,status,createdAt,updatedAt,completedAt")
    .eq("organizationId",result.organization.id).order("createdAt",{ascending:false}).limit(25);
  if(error)throw error;
  s.json({batches:data||[],workerEnabled:bulkWorkerReady()});
}));

app.get("/api/organization/certificates/bulk/batches/:batchId",auth,roles("EMPLOYER"),run(async(q,s)=>{
  const result=await bulkInstitutionFor(q,false);if(result.error)return s.status(result.status).json({error:result.error});
  const {data:batch,error}=await q.supabase.from("CertificateIssuanceBatch")
    .select("id,organizationId,createdBy,fileName,method,totalItems,queuedItems,processingItems,issuedItems,failedItems,documentFailedItems,status,createdAt,updatedAt,completedAt")
    .eq("id",q.params.batchId).eq("organizationId",result.organization.id).maybeSingle();
  if(error)throw error;if(!batch)return s.status(404).json({error:"Bulk issuance batch not found."});
  const {data:items,error:itemError}=await q.supabase.from("CertificateIssuanceItem")
    .select("id,rowNumber,studentNumber,payload,status,certificateId,errorCode,errorMessage,documentName,createdAt,updatedAt,processedAt")
    .eq("batchId",batch.id).order("rowNumber",{ascending:true});
  if(itemError)throw itemError;
  s.json({batch,items:items||[],workerEnabled:bulkWorkerReady()});
}));

app.post("/api/organization/certificates/bulk/batches",auth,roles("EMPLOYER"),run(async(q,s)=>{
  const result=await bulkInstitutionFor(q,true);if(result.error)return s.status(result.status).json({error:result.error});
  if(!SUPABASE_SERVER_KEY)return s.status(503).json({error:"Durable bulk issuance is not configured. Add a server-only Supabase service key in Render."});
  if(!BULK_CERTIFICATE_WORKER_ENABLED)return s.status(503).json({error:"The bulk certificate worker is not enabled yet. Contact the VERITY administrator before submitting a batch."});
  const b=bulkBatchInput.parse(q.body);
  const server=makeServerClient(),id=crypto.randomUUID();
  const fileName=bulkSafeName(b.fileName);
  if(b.campaignId){
    const {data:allocation,error}=await server.rpc("create_certificate_issuance_campaign_batch",{
      p_campaign_id:b.campaignId,p_batch_id:id,p_owner_id:q.user.id,p_file_name:fileName,
      p_method:b.method,p_total_items:b.totalItems
    });
    if(error)return s.status(409).json({error:error.message});
    return s.status(201).json({batch:allocation?.batch||null,workerEnabled:true});
  }
  const {data,error}=await server.from("CertificateIssuanceBatch").insert({
    id,organizationId:result.organization.id,createdBy:q.user.id,fileName,method:b.method,totalItems:b.totalItems,status:"UPLOADING"
  }).select("id,organizationId,fileName,method,totalItems,status,createdAt").single();
  if(error)throw error;
  s.status(201).json({batch:data,workerEnabled:true});
}));

app.post("/api/organization/certificates/bulk/batches/:batchId/items/:itemId/document",auth,roles("EMPLOYER"),
  express.raw({type:"application/pdf",limit:"10mb"}),run(async(q,s)=>{
  const result=await bulkInstitutionFor(q,true);if(result.error)return s.status(result.status).json({error:result.error});
  if(!SUPABASE_SERVER_KEY||!BULK_CERTIFICATE_WORKER_ENABLED)return s.status(503).json({error:"The durable bulk certificate worker is not configured."});
  if(!/^[0-9a-f-]{36}$/i.test(q.params.batchId)||!/^[0-9a-f-]{36}$/i.test(q.params.itemId))return s.status(400).json({error:"Invalid batch or item identifier."});
  const bytes=q.body,mime=q.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if(mime!=="application/pdf"||!Buffer.isBuffer(bytes)||!bytes.length||bytes.subarray(0,5).toString("ascii")!=="%PDF-")return s.status(415).json({error:"Upload a valid PDF certificate document."});
  if(bytes.length>10*1024*1024)return s.status(413).json({error:"Each certificate PDF must be 10 MB or smaller."});
  const server=makeServerClient();
  const {data:batch,error:batchError}=await server.from("CertificateIssuanceBatch").select("id,organizationId,createdBy,status").eq("id",q.params.batchId).maybeSingle();
  if(batchError)throw batchError;
  if(!batch||batch.organizationId!==result.organization.id||batch.createdBy!==q.user.id)return s.status(404).json({error:"Bulk issuance batch not found in your institution."});
  if(batch.status!=="UPLOADING")return s.status(409).json({error:"This batch is no longer accepting documents."});
  let rawName=String(q.headers["x-file-name"]||"certificate.pdf");try{rawName=decodeURIComponent(rawName);}catch{}
  const documentName=bulkSafeName(rawName);
  const sha256=digest(bytes),storagePath=`bulk-staging/${result.organization.id}/${batch.id}/${q.params.itemId}.pdf`;
  const storage=server.storage.from("verity-certificates");
  const {error:uploadError}=await storage.upload(storagePath,bytes,{contentType:"application/pdf",upsert:false,cacheControl:"3600"});
  if(uploadError){
    const {data:existing,error:existingError}=await storage.download(storagePath);
    if(existingError)throw uploadError;
    const existingBytes=Buffer.from(await existing.arrayBuffer());
    if(digest(existingBytes)!==sha256)return s.status(409).json({error:"This item identifier already has a different PDF. Start a new upload."});
  }
  s.status(201).json({documentName,sha256,sizeBytes:bytes.length});
}));

app.post("/api/organization/certificates/bulk/batches/:batchId/items",auth,roles("EMPLOYER"),run(async(q,s)=>{
  const result=await bulkInstitutionFor(q,true);if(result.error)return s.status(result.status).json({error:result.error});
  if(!SUPABASE_SERVER_KEY||!BULK_CERTIFICATE_WORKER_ENABLED)return s.status(503).json({error:"The durable bulk certificate worker is not configured."});
  const b=bulkItemInput.parse(q.body),server=makeServerClient();
  const {data:batch,error:batchError}=await server.from("CertificateIssuanceBatch").select("id,organizationId,createdBy,status").eq("id",q.params.batchId).maybeSingle();
  if(batchError)throw batchError;
  if(!batch||batch.organizationId!==result.organization.id||batch.createdBy!==q.user.id)return s.status(404).json({error:"Bulk issuance batch not found in your institution."});
  if(batch.status!=="UPLOADING")return s.status(409).json({error:"This batch is no longer accepting rows."});
  const clean=Object.fromEntries(Object.entries(b.payload).map(([key,value])=>[key,typeof value==="string"?value.trim():value]));
  clean.institution=result.organization.name;
  clean.studentEmail=String(clean.studentEmail||"").trim().toLowerCase();
  const normalizedStudentNumber=String(clean.studentNumber||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
  if(normalizedStudentNumber.length<2)return s.status(400).json({error:"Student number is invalid after normalization."});
  const documentName=bulkSafeName(b.documentName||("VERITY-"+normalizedStudentNumber+".pdf"));
  const generated=batch.method==="CSV_GENERATED";
  if(generated&&!b.documentSha256){
    const {data:template,error:templateError}=await server.from("InstitutionCertificateTemplate")
      .select("id").eq("organizationId",result.organization.id).eq("status","ACTIVE").eq("isDefault",true).maybeSingle();
    if(templateError)throw templateError;
    if(!template)return s.status(409).json({error:"Approve and activate a certificate design before using generated-PDF bulk issuance."});
  }else if(!b.documentSha256){
    return s.status(400).json({error:"Upload a PDF for this batch method, or choose CSV_GENERATED with an approved active design."});
  }
  const documentStoragePath=generated&&!b.documentSha256?null:`bulk-staging/${result.organization.id}/${batch.id}/${b.itemId}.pdf`;
  if(documentStoragePath){
    const {data:stagedFile,error:stagedError}=await server.storage.from("verity-certificates").download(documentStoragePath);
    if(stagedError)return s.status(400).json({error:"Upload the matching PDF before staging this certificate row."});
    const stagedBytes=Buffer.from(await stagedFile.arrayBuffer());
    if(stagedBytes.subarray(0,5).toString("ascii")!=="%PDF-"||digest(stagedBytes)!==b.documentSha256)return s.status(409).json({error:"The staged PDF failed its SHA-256 or PDF-signature check."});
  }
  const idempotencyKey=digest(JSON.stringify({batchId:batch.id,rowNumber:b.rowNumber,studentNumber:normalizedStudentNumber,payload:clean,documentSha256:b.documentSha256||"GENERATED_FROM_ACTIVE_TEMPLATE"}));
  const row={
    id:b.itemId,batchId:batch.id,organizationId:result.organization.id,rowNumber:b.rowNumber,
    studentNumber:normalizedStudentNumber,idempotencyKey,payload:clean,
    documentStoragePath,documentName,documentSha256:b.documentSha256||null,status:"STAGED",attempts:0
  };
  const {data,error}=await server.from("CertificateIssuanceItem").insert(row).select("id,batchId,rowNumber,studentNumber,status,documentName,documentSha256").single();
  if(error){
    if(error.code==="23505"){
      const {data:existing,error:lookupError}=await server.from("CertificateIssuanceItem").select("id,batchId,rowNumber,studentNumber,idempotencyKey,status").eq("id",b.itemId).maybeSingle();
      if(lookupError)throw lookupError;
      if(existing&&existing.idempotencyKey===idempotencyKey)return s.json({item:existing,alreadyStaged:true});
      return s.status(409).json({error:"A different row already uses this item or student number in the batch."});
    }
    throw error;
  }
  s.status(201).json({item:data});
}));

app.post("/api/organization/certificates/bulk/batches/:batchId/complete",auth,roles("EMPLOYER"),run(async(q,s)=>{
  const result=await bulkInstitutionFor(q,true);if(result.error)return s.status(result.status).json({error:result.error});
  if(!SUPABASE_SERVER_KEY||!BULK_CERTIFICATE_WORKER_ENABLED)return s.status(503).json({error:"The durable bulk certificate worker is not configured."});
  const server=makeServerClient();
  const {data,error}=await server.rpc("queue_certificate_issuance_batch",{p_batch_id:q.params.batchId,p_owner_id:q.user.id});
  if(error)return s.status(409).json({error:error.message});
  s.json({batch:data?.batch||null,alreadySubmitted:Boolean(data?.alreadySubmitted),workerEnabled:true,message:"Batch submitted. VERITY will continue issuing certificates in the background."});
}));

app.get("/api/certificates/:id/qr",auth,run(async(q,s)=>{
  const {data:c,error}=await q.supabase.from("Certificate").select("id,certificateId,verificationKey,graduateId,organizationId").eq("certificateId",q.params.id).maybeSingle();
  if(error)throw error;
  if(!c)return s.status(404).json({error:"Certificate not found."});
  if(q.user.role==="EMPLOYER"){
    const {data:org,error:oe}=await q.supabase.from("Organization").select("id,status,type").eq("ownerId",q.user.id).maybeSingle();
    if(oe)throw oe;
    if(!org||org.id!==c.organizationId||org.status!=="APPROVED"||!(await hasApprovedOrganizationCapability(q.supabase,org.id,"ISSUE_CREDENTIALS")))return s.status(403).json({error:"Only the approved credential issuer can generate its certificate QR."});
  }
  if(q.user.role==="GRADUATE"&&c.graduateId!==q.user.id){
    const staff=staffForOrganization(await activeStaffFor(q.supabase,q.user.id),c.organizationId);
    if(!hasStaffPermission(staff,"certificates:read"))return s.status(403).json({error:"Your active staff assignment does not allow certificate reading for this organization."});
  }
  const url=`${process.env.PUBLIC_APP_URL||q.protocol+"://"+q.get("host")}/verify/${encodeURIComponent(c.verificationKey)}`;
  s.json({url,key:c.verificationKey,certificateId:c.certificateId,dataUrl:await QRCode.toDataURL(url,{width:420,margin:2})});
}));

app.post("/api/certificates/:id/revoke",auth,roles("ADMIN","EMPLOYER"),run(async(q,s)=>{
  const b=z.object({reason:z.string().trim().min(5).max(500)}).parse(q.body);
  let query=q.supabase.from("Certificate").select("id,certificateId,status,organizationId").eq("certificateId",q.params.id);
  if(q.user.role==="EMPLOYER"){
    const {data:org,error:orgError}=await q.supabase.from("Organization").select("id,status,type").eq("ownerId",q.user.id).maybeSingle();
    if(orgError)throw orgError;
    if(!org||org.status!=="APPROVED"||!(await hasApprovedOrganizationCapability(q.supabase,org.id,"ISSUE_CREDENTIALS")))return s.status(403).json({error:"Only an approved credential issuer can revoke its own certificates."});
    query=query.eq("organizationId",org.id);
  }
  const {data:c,error}=await query.maybeSingle();
  if(error) throw error;
  if(!c) return s.status(404).json({error:"Certificate not found in your institution's issuance records."});
  if(c.status==="REVOKED") return s.status(409).json({error:"This certificate has already been revoked."});
  const now=new Date().toISOString();
  const {data:updated,error:updateError}=await q.supabase.from("Certificate").update({status:"REVOKED",revokedAt:now,revokeReason:b.reason,updatedAt:now}).eq("id",c.id).eq("status","ACTIVE").select().maybeSingle();
  if(updateError) throw updateError;
  if(!updated)return s.status(409).json({error:"The certificate status changed before revocation completed. Refresh and try again."});
  // The PostgreSQL status trigger records the revocation in the append-only ledger
  // in the same database transaction as this update.
  let chain={mode:"SUPABASE_PRIMARY"};
  try{chain=await revokeOnChain(c.certificateId,b.reason);}catch(error){
    console.error("Optional blockchain revocation anchor failed after database revocation:",error);
    chain={mode:"SUPABASE_PRIMARY",error:true};
  }
  await audit(q.supabase,q.user.id,"CERTIFICATE_REVOKED","Certificate",c.id,{reason:b.reason,mode:chain.mode||"SUPABASE_PRIMARY",blockchainAnchorPending:Boolean(chain.error),organizationId:c.organizationId||null});
  const {data:graduate}=await q.supabase.from("Certificate").select("graduateId").eq("id",c.id).maybeSingle();
  if(graduate?.graduateId)await createVerityNotification(graduate.graduateId,{type:"CERTIFICATE_REVOKED",category:"CERTIFICATE",title:"Your certificate was revoked",body:"Certificate "+c.certificateId+" is no longer active. "+b.reason,url:"/certificates",metadata:{certificateId:c.certificateId}});
  await notifyVerityAdmins({type:"CERTIFICATE_REVOKED",category:"PLATFORM",title:"Certificate revoked",body:c.certificateId+" was revoked.",url:"/certificates",metadata:{certificateId:c.certificateId}});
  s.json({certificate:updated,chainMode:chain.mode||"SUPABASE_PRIMARY",blockchainAnchorPending:Boolean(chain.error)});
}));


const documentMime = new Map([
  ["application/pdf",{ext:"pdf",magic:b=>b.subarray(0,5).toString("ascii")==="%PDF-"}],
  ["image/jpeg",{ext:"jpg",magic:b=>b.length>=3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff}],
  ["image/png",{ext:"png",magic:b=>b.length>=8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))}]
]);

async function certificateDesignInstitution(q){
 const {data:org,error}=await q.supabase.from("Organization").select("id,name,type,status,ownerId").eq("ownerId",q.user.id).maybeSingle();
 if(error)throw error;
 if(!org)return {error:"Organization not found.",status:404};
 if(org.status!=="APPROVED")return {error:"Your organization must be approved before managing certificate designs.",status:403};
 if(!(await hasApprovedOrganizationCapability(q.supabase,org.id,"ISSUE_CREDENTIALS")))return {error:"Your organization does not have an approved credential-issuance capability.",status:403};
 return {organization:org};
}
const designName=value=>String(value||"").normalize("NFKC").trim().slice(0,120);
const designFieldLayout=layout=>Object.fromEntries(Object.entries(layout||{}).filter(([key,value])=>["studentName","studentNumber","qualification","programme","faculty","department","classification","awardDate","certificateId"].includes(key)&&value&&typeof value==="object"&&!Array.isArray(value)));
app.post("/api/organization/certificate-design/templates/:id/preview",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const access=await certificateDesignInstitution(q);if(access.error)return s.status(access.status).json({error:access.error});
 if(!/^[0-9a-f-]{36}$/i.test(q.params.id))return s.status(400).json({error:"Invalid template identifier."});
 const b=z.object({studentName:z.string().trim().min(2).max(180).default("Amina Yusuf"),studentNumber:z.string().trim().max(80).default("PREVIEW-0001"),qualification:z.string().trim().max(120).default("B.Sc."),programme:z.string().trim().max(180).default("Computer Science"),faculty:z.string().trim().max(180).default("Faculty of Computing"),department:z.string().trim().max(180).default("Computer Science"),classification:z.string().trim().max(80).default("First Class"),awardDate:z.string().trim().max(40).default("2026-11-24")}).default({}).parse(q.body||{});
 const db=makeServerClient();
 const {data:template,error}=await db.from("InstitutionCertificateTemplate").select("id,organizationId,name,sourceType,templateKey,assetStoragePath,assetMimeType,assetSha256,pageSize,fieldLayout,status").eq("id",q.params.id).eq("organizationId",access.organization.id).maybeSingle();
 if(error)throw error;if(!template)return s.status(404).json({error:"Certificate design not found in your institution."});
 let artworkBytes=null;
 if(template.sourceType==="INSTITUTION_ARTWORK"){
  if(!template.assetStoragePath)return s.status(409).json({error:"The artwork asset is missing."});
  const {data:file,error:downloadError}=await db.storage.from("verity-certificates").download(template.assetStoragePath);
  if(downloadError)throw downloadError;
  artworkBytes=Buffer.from(await file.arrayBuffer());
  if(!template.assetSha256||digest(artworkBytes)!==template.assetSha256)return s.status(409).json({error:"Artwork integrity check failed. The stored file does not match its SHA-256 fingerprint."});
 }
 const fieldLayout=validateFieldLayout(designFieldLayout(template.fieldLayout));
 const pdf=await renderCertificatePreview({template:{...template,fieldLayout},organizationName:access.organization.name,data:b,artworkBytes});
 await audit(q.supabase,q.user.id,"CERTIFICATE_TEMPLATE_PREVIEW_RENDERED","InstitutionCertificateTemplate",template.id,{organizationId:access.organization.id,sourceType:template.sourceType});
 s.setHeader("Content-Type","application/pdf");s.setHeader("Content-Disposition",`inline; filename="VERITY-${template.id}-PREVIEW.pdf"`);s.setHeader("Cache-Control","private, no-store");s.send(pdf);
}));
app.get("/api/organization/certificate-design/templates",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const access=await certificateDesignInstitution(q);if(access.error)return s.status(access.status).json({error:access.error});
 const db=makeServerClient();
 const {data,error}=await db.from("InstitutionCertificateTemplate").select("id,name,sourceType,templateKey,assetMimeType,pageSize,fieldLayout,version,isDefault,status,createdAt,updatedAt").eq("organizationId",access.organization.id).order("updatedAt",{ascending:false});
 if(error)throw error;s.json({templates:data||[]});
}));
app.post("/api/organization/certificate-design/templates",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const access=await certificateDesignInstitution(q);if(access.error)return s.status(access.status).json({error:access.error});
 const b=z.object({name:z.string().trim().min(2).max(120),sourceType:z.literal("VERITY_TEMPLATE"),templateKey:z.enum(["verity-heritage","verity-modern","verity-signature"]),pageSize:z.enum(["A4_LANDSCAPE","A4_PORTRAIT","LETTER_LANDSCAPE","LETTER_PORTRAIT"]).default("A4_LANDSCAPE"),fieldLayout:z.record(z.any()).default({})}).parse(q.body);
 const db=makeServerClient(),id=crypto.randomUUID(),now=new Date().toISOString();
 const {data,error}=await db.from("InstitutionCertificateTemplate").insert({id,organizationId:access.organization.id,name:b.name,sourceType:b.sourceType,templateKey:b.templateKey,pageSize:b.pageSize,fieldLayout:b.fieldLayout,version:1,isDefault:false,status:"DRAFT",createdBy:q.user.id,updatedBy:q.user.id,createdAt:now,updatedAt:now}).select("id,name,sourceType,templateKey,pageSize,fieldLayout,version,isDefault,status,createdAt").single();
 if(error)throw error;await audit(q.supabase,q.user.id,"CERTIFICATE_TEMPLATE_CREATED","InstitutionCertificateTemplate",id,{organizationId:access.organization.id,sourceType:"VERITY_TEMPLATE",templateKey:b.templateKey});
 s.status(201).json({template:data});
}));
app.patch("/api/organization/certificate-design/templates/:id",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const access=await certificateDesignInstitution(q);if(access.error)return s.status(access.status).json({error:access.error});
 const b=z.object({fieldLayout:z.record(z.any()),pageSize:z.enum(["A4_LANDSCAPE","A4_PORTRAIT","LETTER_LANDSCAPE","LETTER_PORTRAIT"]).optional()}).strict().parse(q.body);
 let layout=b.fieldLayout;
 if(layout.fields&&!Object.keys(layout).some(k=>k!=="fields"))layout={};
 layout=validateFieldLayout(layout);
 const db=makeServerClient(),{data:current,error:ce}=await db.from("InstitutionCertificateTemplate").select("id,status,version").eq("id",q.params.id).eq("organizationId",access.organization.id).maybeSingle();
 if(ce)throw ce;if(!current)return s.status(404).json({error:"Certificate design not found."});
 if(current.status!=="DRAFT")return s.status(409).json({error:"Only draft designs can be edited. Create a new version to change an active design."});
 const patch={fieldLayout:layout,version:current.version+1,updatedBy:q.user.id,updatedAt:new Date().toISOString(),...(b.pageSize?{pageSize:b.pageSize}:{})};
 const {data,error}=await db.from("InstitutionCertificateTemplate").update(patch).eq("id",current.id).eq("organizationId",access.organization.id).eq("status","DRAFT").select("id,name,fieldLayout,pageSize,version,status,updatedAt").single();
 if(error)throw error;await audit(q.supabase,q.user.id,"CERTIFICATE_TEMPLATE_LAYOUT_UPDATED","InstitutionCertificateTemplate",current.id,{organizationId:access.organization.id,version:data.version});
 s.json({template:data});
}));
app.post("/api/organization/certificate-design/templates/:id/activate",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const access=await certificateDesignInstitution(q);if(access.error)return s.status(access.status).json({error:access.error});
 z.object({confirm:z.literal(true)}).parse(q.body||{});
 const db=makeServerClient(),{data:template,error:te}=await db.from("InstitutionCertificateTemplate").select("id,name,status,sourceType,templateKey,assetStoragePath,assetMimeType,assetSha256,fieldLayout,pageSize").eq("id",q.params.id).eq("organizationId",access.organization.id).maybeSingle();
 if(te)throw te;if(!template)return s.status(404).json({error:"Certificate design not found."});
 if(template.status!=="DRAFT")return s.status(409).json({error:"Only a draft design can be approved and activated."});
 if(template.sourceType==="INSTITUTION_ARTWORK"){
  if(!template.assetStoragePath)return s.status(409).json({error:"The institution artwork is missing."});
  const {data:file,error}=await db.storage.from("verity-certificates").download(template.assetStoragePath);if(error)throw error;
  const bytes=Buffer.from(await file.arrayBuffer());if(!template.assetSha256||digest(bytes)!==template.assetSha256)return s.status(409).json({error:"Artwork integrity check failed."});
 }
 const layout=validateFieldLayout(designFieldLayout(template.fieldLayout));
 let artworkBytes=null;if(template.sourceType==="INSTITUTION_ARTWORK"){const {data:file,error}=await db.storage.from("verity-certificates").download(template.assetStoragePath);if(error)throw error;artworkBytes=Buffer.from(await file.arrayBuffer());if(digest(artworkBytes)!==template.assetSha256)return s.status(409).json({error:"Artwork integrity check failed."});}
 const pdf=await renderCertificatePreview({template:{...template,fieldLayout:layout},organizationName:access.organization.name,data:{studentName:"APPROVAL SAMPLE",studentNumber:"APPROVAL-0001",qualification:"B.Sc.",programme:"Computer Science",faculty:"Faculty",department:"Department",classification:"Sample",awardDate:new Date().toISOString().slice(0,10)},artworkBytes});
 if(!pdf?.subarray(0,5).toString("ascii").startsWith("%PDF-"))return s.status(422).json({error:"A valid PDF preview could not be rendered."});
 const {error:deactivateError}=await db.from("InstitutionCertificateTemplate").update({status:"ARCHIVED",isDefault:false,updatedAt:new Date().toISOString(),updatedBy:q.user.id}).eq("organizationId",access.organization.id).eq("status","ACTIVE");
 if(deactivateError)throw deactivateError;
 const {data:activated,error}=await db.from("InstitutionCertificateTemplate").update({status:"ACTIVE",isDefault:true,updatedAt:new Date().toISOString(),updatedBy:q.user.id}).eq("id",template.id).eq("organizationId",access.organization.id).eq("status","DRAFT").select("id,name,status,isDefault,version").single();
 if(error)throw error;await audit(q.supabase,q.user.id,"CERTIFICATE_TEMPLATE_APPROVED_AND_ACTIVATED","InstitutionCertificateTemplate",template.id,{organizationId:access.organization.id,version:activated.version});
 s.json({template:activated,message:"Design approved and activated for future issuance."});
}));
app.post("/api/organization/certificate-design/templates/artwork",auth,roles("EMPLOYER"),express.raw({type:["application/pdf","image/jpeg","image/png"],limit:"10mb"}),run(async(q,s)=>{
 const access=await certificateDesignInstitution(q);if(access.error)return s.status(access.status).json({error:access.error});
 const mime=q.headers["content-type"]?.split(";")[0]?.trim().toLowerCase(),spec=documentMime.get(mime),bytes=q.body;
 if(!spec||!Buffer.isBuffer(bytes)||!bytes.length)return s.status(400).json({error:"Upload an approved PDF, JPEG or PNG artwork file."});
 if(bytes.length>10*1024*1024)return s.status(413).json({error:"The maximum file size is 10 MB."});
 if(!spec.magic(bytes))return s.status(415).json({error:"The file content does not match its declared type."});
 const id=crypto.randomUUID(),name=designName(decodeURIComponent(String(q.headers["x-template-name"]||"Institution certificate design")));
 if(name.length<2)return s.status(400).json({error:"Enter a design name."});
 const safeName=String(decodeURIComponent(String(q.headers["x-file-name"]||("artwork."+spec.ext)))).normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,120)||("artwork."+spec.ext);
 const storagePath="templates/"+access.organization.id+"/"+id+"/"+crypto.randomUUID()+"."+spec.ext,sha256=digest(bytes),db=makeServerClient();
 const {error:uploadError}=await db.storage.from("verity-certificates").upload(storagePath,bytes,{contentType:mime,upsert:false,cacheControl:"3600"});if(uploadError)throw uploadError;
 const now=new Date().toISOString();
 const {data,error}=await db.from("InstitutionCertificateTemplate").insert({id,organizationId:access.organization.id,name,sourceType:"INSTITUTION_ARTWORK",assetStoragePath:storagePath,assetMimeType:mime,assetSha256:sha256,pageSize:"A4_LANDSCAPE",fieldLayout:{fields:["studentName","studentNumber","qualification","programme","faculty","department","classification","awardDate","certificateId","verificationQr"],originalFileName:safeName},version:1,isDefault:false,status:"DRAFT",createdBy:q.user.id,updatedBy:q.user.id,createdAt:now,updatedAt:now}).select("id,name,sourceType,assetMimeType,assetSha256,pageSize,fieldLayout,version,isDefault,status,createdAt").single();
 if(error){await db.storage.from("verity-certificates").remove([storagePath]);throw error;}
 await audit(q.supabase,q.user.id,"CERTIFICATE_TEMPLATE_ARTWORK_UPLOADED","InstitutionCertificateTemplate",id,{organizationId:access.organization.id,sha256,sizeBytes:bytes.length,mimeType:mime});
 s.status(201).json({template:data,message:"Artwork stored privately as a draft. Configure and preview field positions before production rendering."});
}));
app.get("/api/organization/certificate-design/digitization",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const access=await certificateDesignInstitution(q);if(access.error)return s.status(access.status).json({error:access.error});
 const db=makeServerClient(),{data,error}=await db.from("CertificateDigitizationCase").select("id,studentNumber,claimedStudentName,sourceFileName,sourceMimeType,sourceSizeBytes,sourceSha256,status,reviewNote,certificateId,createdAt,reviewedAt,issuedAt").eq("organizationId",access.organization.id).order("createdAt",{ascending:false}).limit(100);
 if(error)throw error;s.json({cases:data||[]});
}));
app.post("/api/organization/certificate-design/digitization",auth,roles("EMPLOYER"),express.raw({type:["application/pdf","image/jpeg","image/png"],limit:"10mb"}),run(async(q,s)=>{
 const access=await certificateDesignInstitution(q);if(access.error)return s.status(access.status).json({error:access.error});
 const mime=q.headers["content-type"]?.split(";")[0]?.trim().toLowerCase(),spec=documentMime.get(mime),bytes=q.body;
 if(!spec||!Buffer.isBuffer(bytes)||!bytes.length)return s.status(400).json({error:"Upload an existing certificate as PDF, JPEG or PNG."});
 if(bytes.length>10*1024*1024)return s.status(413).json({error:"The maximum file size is 10 MB."});
 if(!spec.magic(bytes))return s.status(415).json({error:"The file content does not match its declared type."});
 let credentialData;try{credentialData=JSON.parse(decodeURIComponent(String(q.headers["x-credential-data"]||"%7B%7D")));}catch{return s.status(400).json({error:"Credential details are not valid JSON."});}
 const studentNumber=decodeURIComponent(String(q.headers["x-student-number"]||"")).trim(),claimedStudentName=decodeURIComponent(String(q.headers["x-student-name"]||"")).trim();
 if(studentNumber.length<2||claimedStudentName.length<2)return s.status(400).json({error:"Provide the graduate's full name and matriculation number."});
 const id=crypto.randomUUID(),safeName=String(decodeURIComponent(String(q.headers["x-file-name"]||("existing-certificate."+spec.ext)))).normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,120)||("existing-certificate."+spec.ext);
 const storagePath="digitization/"+access.organization.id+"/"+id+"/source."+spec.ext,sha256=digest(bytes),db=makeServerClient();
 const {error:uploadError}=await db.storage.from("verity-certificates").upload(storagePath,bytes,{contentType:mime,upsert:false,cacheControl:"3600"});if(uploadError)throw uploadError;
 const {data,error}=await db.from("CertificateDigitizationCase").insert({id,organizationId:access.organization.id,submittedBy:q.user.id,studentNumber,claimedStudentName,credentialData,sourceStoragePath:storagePath,sourceFileName:safeName,sourceMimeType:mime,sourceSizeBytes:bytes.length,sourceSha256:sha256,status:"PENDING_REVIEW",createdAt:new Date().toISOString()}).select("id,status,createdAt").single();
 if(error){await db.storage.from("verity-certificates").remove([storagePath]);throw error;}
 await audit(q.supabase,q.user.id,"CERTIFICATE_DIGITIZATION_SUBMITTED","CertificateDigitizationCase",id,{organizationId:access.organization.id,sha256,sizeBytes:bytes.length});
 s.status(201).json({case:data,message:"Submitted for institutional review. This upload is not yet a verified credential."});
}));
app.patch("/api/organization/certificate-design/digitization/:id",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const access=await certificateDesignInstitution(q);if(access.error)return s.status(access.status).json({error:access.error});
 const b=z.object({status:z.enum(["APPROVED","REJECTED"]),reviewNote:z.string().max(1000).optional()}).parse(q.body),db=makeServerClient();
 const {data:current,error:ce}=await db.from("CertificateDigitizationCase").select("id,status").eq("id",q.params.id).eq("organizationId",access.organization.id).maybeSingle();
 if(ce)throw ce;if(!current)return s.status(404).json({error:"Digitisation case not found."});
 if(current.status!=="PENDING_REVIEW")return s.status(409).json({error:"Only pending cases can be reviewed."});
 const now=new Date().toISOString(),{data,error}=await db.from("CertificateDigitizationCase").update({status:b.status,reviewedBy:q.user.id,reviewedAt:now,reviewNote:b.reviewNote||null}).eq("id",current.id).eq("organizationId",access.organization.id).eq("status","PENDING_REVIEW").select("id,status,reviewedAt,reviewNote").single();
 if(error)throw error;await audit(q.supabase,q.user.id,"CERTIFICATE_DIGITIZATION_"+b.status,"CertificateDigitizationCase",current.id,{organizationId:access.organization.id});
 s.json({case:data,message:b.status==="APPROVED"?"Validated. Issue a matching VERITY credential through the normal issuance workflow.":"Digitisation case rejected."});
}));
app.post("/api/organization/certificate-design/digitization/:id/convert",auth,roles("EMPLOYER"),run(async(q,s)=>{
 const access=await certificateDesignInstitution(q);if(access.error)return s.status(access.status).json({error:access.error});
 const db=makeServerClient();
 const {data:caseRow,error:caseError}=await db.from("CertificateDigitizationCase")
  .select("id,organizationId,submittedBy,studentNumber,claimedStudentName,credentialData,sourceStoragePath,sourceFileName,sourceMimeType,sourceSizeBytes,sourceSha256,status,reviewedBy,certificateId")
  .eq("id",q.params.id).eq("organizationId",access.organization.id).maybeSingle();
 if(caseError)throw caseError;if(!caseRow)return s.status(404).json({error:"Historical certificate case not found."});
 let alreadyIssuedCertificate=null;
 if(caseRow.status==="ISSUED"&&caseRow.certificateId){
  const {data:existing,error:existingError}=await db.from("Certificate").select("*").eq("certificateId",caseRow.certificateId).maybeSingle();
  if(existingError)throw existingError;if(!existing)return s.status(409).json({error:"The issued historical case is missing its credential record."});
  alreadyIssuedCertificate=existing;
 }else if(caseRow.status!=="APPROVED")return s.status(409).json({error:"Only an institution-approved historical certificate can be converted."});
 if(!caseRow.reviewedBy)return s.status(409).json({error:"The historical record has no recorded institutional reviewer."});
 const {data:source,error:sourceError}=await db.storage.from("verity-certificates").download(caseRow.sourceStoragePath);
 if(sourceError)throw sourceError;
 const sourceBytes=Buffer.from(await source.arrayBuffer());
 const spec=documentMime.get(caseRow.sourceMimeType);
 if(!spec||sourceBytes.length!==caseRow.sourceSizeBytes||digest(sourceBytes)!==caseRow.sourceSha256||!spec.magic(sourceBytes))
  return s.status(409).json({error:"The original historical scan failed its stored size, file-type or SHA-256 integrity check. No credential was issued."});
 const academic=caseRow.credentialData||{};
 const clean={
  studentName:String(caseRow.claimedStudentName||"").trim(),
  studentEmail:String(academic.studentEmail||"").trim().toLowerCase()||null,
  studentNumber:String(caseRow.studentNumber||"").trim(),
  institution:access.organization.name,
  faculty:String(academic.faculty||"").trim(),
  department:String(academic.department||"").trim(),
  programme:String(academic.programme||"").trim(),
  qualification:String(academic.qualification||"").trim(),
  classification:String(academic.classification||"").trim()||null,
  awardDate:academic.awardDate
 };
 if(!clean.studentName||!clean.studentNumber||!clean.faculty||!clean.department||!clean.programme||!clean.qualification||!clean.awardDate)
  return s.status(422).json({error:"The approved case is missing required academic details. Update the case details through the institution review process before conversion."});
 const awardDate=new Date(clean.awardDate);
 if(Number.isNaN(awardDate.getTime()))return s.status(422).json({error:"The historical award date is invalid."});
 clean.awardDate=awardDate.toISOString();
 if(clean.studentEmail){
  const {data:graduate,error:graduateError}=await db.from("User").select("id").eq("email",clean.studentEmail).maybeSingle();
  if(graduateError)throw graduateError;
  clean.graduateId=graduate?.id||null;
 }else clean.graduateId=null;
 const certificateId=`VRT-${new Date().getFullYear()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
 const verificationKey=`VRT-${crypto.randomBytes(16).toString("hex").toUpperCase()}`;
 const canonicalRecord={
  certificateId,studentName:clean.studentName.trim(),studentNumber:clean.studentNumber.trim(),
  institution:clean.institution.trim(),faculty:clean.faculty.trim(),department:clean.department.trim(),
  programme:clean.programme.trim(),qualification:clean.qualification.trim(),
  classification:clean.classification||"",awardDate:clean.awardDate
 };
 const hash=digest(JSON.stringify(canonicalRecord)),now=new Date().toISOString();
 const record={
  id:crypto.randomUUID(),...clean,certificateId,verificationKey,organizationId:access.organization.id,
  digest:hash,txHash:null,chainId:null,contractAddress:null,status:"ACTIVE",
  issuerId:caseRow.reviewedBy,createdAt:now,updatedAt:now,issuedAt:now
 };
 let certificate=alreadyIssuedCertificate;
 if(!certificate){
  const {data:converted,error:convertError}=await db.rpc("verity_convert_digitization_case",{p_case_id:caseRow.id,p_certificate:record});
  if(convertError){
   if(String(convertError.message||"").includes("Only institution-approved"))return s.status(409).json({error:convertError.message});
   throw convertError;
  }
  certificate=converted;
 }
 const {data:existingEvidence,error:evidenceLookupError}=await db.from("CertificateDocument")
  .select("id,sha256").eq("certificateId",certificate.id).eq("sha256",caseRow.sourceSha256).maybeSingle();
 if(evidenceLookupError)throw evidenceLookupError;
 if(!existingEvidence){
  const evidenceId=crypto.randomUUID();
  const {error:evidenceInsertError}=await db.from("CertificateDocument").insert({
   id:evidenceId,certificateId:certificate.id,organizationId:access.organization.id,
   storagePath:caseRow.sourceStoragePath,originalName:caseRow.sourceFileName,
   mimeType:caseRow.sourceMimeType,sizeBytes:caseRow.sourceSizeBytes,sha256:caseRow.sourceSha256,
   uploadedBy:caseRow.submittedBy||q.user.id,scanStatus:"NOT_SCANNED"
  });
  if(evidenceInsertError)throw evidenceInsertError;
  try{await audit(q.supabase,q.user.id,"HISTORICAL_CERTIFICATE_EVIDENCE_ATTACHED","CertificateDocument",evidenceId,{certificateId:certificate.certificateId,caseId:caseRow.id,sha256:caseRow.sourceSha256,originalEvidenceRetained:true});}catch(auditError){console.error("Historical evidence audit failed:",auditError);}
 }
 await audit(q.supabase,q.user.id,"HISTORICAL_CERTIFICATE_CONVERTED","Certificate",certificate.id,{certificateId:certificate.certificateId,caseId:caseRow.id,organizationId:access.organization.id,sourceSha256:caseRow.sourceSha256,mode:"SUPABASE_LEDGER"});
 if(certificate.graduateId)try{await createVerityNotification(certificate.graduateId,{type:"CERTIFICATE_ISSUED",category:"CERTIFICATE",title:"A historical certificate is now available",body:"A validated historical certificate from "+access.organization.name+" has been added to your VERITY account.",url:"/certificates",metadata:{certificateId:certificate.certificateId}});}catch(notificationError){console.error("Historical certificate graduate notification failed:",notificationError);}
 try{await notifyVerityAdmins({type:"CERTIFICATE_ISSUED",category:"PLATFORM",title:"Historical certificate converted",body:certificate.certificateId+" was issued from an approved historical record.",url:"/certificates",metadata:{certificateId:certificate.certificateId,caseId:caseRow.id}});}catch(notificationError){console.error("Historical conversion admin notification failed:",notificationError);}
 s.status(alreadyIssuedCertificate?200:201).json({certificate,idempotent:!!alreadyIssuedCertificate,sourceEvidence:{sha256:caseRow.sourceSha256,originalName:caseRow.sourceFileName,retained:true},message:"Historical certificate converted through the canonical VERITY issuance and ledger workflow. The original scan remains private and unchanged."});
}));
 
app.post("/api/certificates/:id/document",auth,roles("EMPLOYER"),express.raw({type:["application/pdf","image/jpeg","image/png"],limit:"10mb"}),run(async(q,s)=>{
  const mime=q.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  const spec=documentMime.get(mime), bytes=q.body;
  if(!spec||!Buffer.isBuffer(bytes)||bytes.length===0)return s.status(400).json({error:"Upload a PDF, JPEG or PNG certificate file."});
  if(bytes.length>10*1024*1024)return s.status(413).json({error:"The maximum file size is 10 MB."});
  if(!spec.magic(bytes))return s.status(415).json({error:"The file content does not match its declared type."});
  const {data:org,error:orgError}=await q.supabase.from("Organization").select("id,status,type").eq("ownerId",q.user.id).maybeSingle();
  if(orgError)throw orgError;
  if(!org||org.status!=="APPROVED"||!(await hasApprovedOrganizationCapability(q.supabase,org.id,"ISSUE_CREDENTIALS")))return s.status(403).json({error:"Only an approved credential issuer can upload official certificate documents."});
  const {data:cert,error:certError}=await q.supabase.from("Certificate").select("id,certificateId,organizationId").eq("certificateId",q.params.id).eq("organizationId",org.id).maybeSingle();
  if(certError)throw certError;
  if(!cert)return s.status(404).json({error:"Certificate not found in your organization."});
  const safeName=String(q.headers["x-file-name"]||("certificate."+spec.ext)).normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,120)||("certificate."+spec.ext);
  const fileId=crypto.randomUUID(),storagePath=`${org.id}/${cert.id}/${fileId}.${spec.ext}`;
  const sha256=digest(bytes);
  const {error:uploadError}=await q.supabase.storage.from("verity-certificates").upload(storagePath,bytes,{contentType:mime,upsert:false,cacheControl:"3600"});
  if(uploadError)throw uploadError;
  const metadata={id:fileId,certificateId:cert.id,organizationId:org.id,storagePath,originalName:safeName,mimeType:mime,sizeBytes:bytes.length,sha256,uploadedBy:q.user.id,scanStatus:"NOT_SCANNED"};
  const {data:doc,error:docError}=await q.supabase.from("CertificateDocument").insert(metadata).select("id,originalName,mimeType,sizeBytes,sha256,scanStatus,createdAt").single();
  if(docError){await q.supabase.storage.from("verity-certificates").remove([storagePath]);throw docError;}
  await audit(q.supabase,q.user.id,"CERTIFICATE_DOCUMENT_UPLOADED","CertificateDocument",doc.id,{certificateId:cert.certificateId,organizationId:org.id,sha256,scanStatus:"NOT_SCANNED",malwareScanning:false});
  s.status(201).json({document:doc,message:"Certificate stored in private storage. VERITY validates file type and SHA-256 integrity; antivirus scanning is not performed."});
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
app.get("/api/certificate-documents/:id/download",auth,roles("ADMIN","GRADUATE"),run(async(q,s)=>{
  const {data:doc,error}=await q.supabase.from("CertificateDocument").select("id,storagePath,originalName,mimeType,certificateId,organizationId,sha256,scanStatus").eq("id",q.params.id).maybeSingle();
  if(error)throw error;
  if(!doc)return s.status(404).json({error:"Document not found."});
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
  if(!doc.sha256)return s.status(409).json({error:"Document has no registered SHA-256 fingerprint and cannot be released."});
  const {data:file,error:fileError}=await q.supabase.storage.from("verity-certificates").download(doc.storagePath);
  if(fileError)throw fileError;
  const bytes=Buffer.from(await file.arrayBuffer());
  if(digest(bytes)!==doc.sha256)return s.status(409).json({error:"Document integrity check failed. The stored file does not match its registered SHA-256 fingerprint."});
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
  if(!org||org.status!=="APPROVED"||!(await hasApprovedOrganizationCapability(q.supabase,org.id,"ISSUE_CREDENTIALS")))return s.status(403).json({error:"Only an approved credential issuer can verify its own issued certificates."});
  const reference=b.certificateId.trim();
  let query=q.supabase.from("Certificate").select("id,certificateId,verificationKey,studentName,studentNumber,institution,faculty,department,programme,qualification,classification,awardDate,issuedAt,digest,txHash,status,organizationId").eq("organizationId",org.id);
  let {data:c,error}=await query.eq("certificateId",reference).maybeSingle();
  if(error)throw error;
  if(!c){const result=await q.supabase.from("Certificate").select("id,certificateId,verificationKey,studentName,studentNumber,institution,faculty,department,programme,qualification,classification,awardDate,issuedAt,digest,txHash,status,organizationId").eq("organizationId",org.id).eq("verificationKey",reference.toUpperCase()).maybeSingle();c=result.data;error=result.error;if(error)throw error;}
  if(!c)return s.status(404).json({verified:false,status:"NOT_FOUND",message:"This certificate reference was not found in your institution's own issuance records."});
  const recomputed=digest(canonical(c)),dbOk=recomputed===c.digest,chain=await verifyCertificateChain(c);
  const chainOk=!chain.enabled||(chain.exists===true&&chain.digest?.toLowerCase()===String(c.digest||"").toLowerCase()&&!chain.revoked);
  const verified=c.status==="ACTIVE"&&dbOk&&chainOk;
  const status=c.status==="REVOKED"||chain.revoked?"REVOKED":verified?"VERIFIED":"INTEGRITY_MISMATCH";
  await audit(q.supabase,q.user.id,"INSTITUTION_CERTIFICATE_VERIFIED","Certificate",c.id,{certificateId:c.certificateId,organizationId:org.id,status});
  await createVerityNotification(q.user.id,{type:"VERIFICATION_COMPLETED",category:"VERIFICATION",title:status==="VERIFIED"?"Certificate verification completed":"Certificate verification needs attention",body:c.certificateId+" · "+status.replaceAll("_"," ").toLowerCase()+".",url:"/verify",metadata:{certificateId:c.certificateId,status}});
  if(status==="INTEGRITY_MISMATCH")await notifyVerityAdmins({type:"VERIFICATION_ALERT",category:"PLATFORM",title:"Certificate integrity verification alert",body:"An institution verification returned an integrity mismatch for "+c.certificateId+".",url:"/activity",metadata:{certificateId:c.certificateId,organizationId:org.id}});
  const issuer=await publicIssuerDetails(q.supabase,c.certificateId);
  s.json({verified,status,issuer,message:verified?"This certificate matches the academic record issued by your institution.":status==="REVOKED"?"Your institution has revoked this certificate.":"The certificate record's integrity check did not match.",certificate:{certificateId:c.certificateId,verificationKey:c.verificationKey,studentName:c.studentName,institution:c.institution,qualification:c.qualification,awardDate:c.awardDate,issuedAt:c.issuedAt,digest:c.digest,txHash:c.txHash,status:c.status},verifierOrganization:org.name,chain:chain.enabled?{enabled:true,exists:chain.exists,network:"Polygon Amoy",chainId:chain.chainId,contractAddress:chain.contractAddress}:{enabled:false,note:"Supabase PostgreSQL certificate ledger; on-chain verification is not active."}});
}));

app.post("/api/institution/verify",auth,roles("EMPLOYER"),run(async(q,s)=>{
  const b=z.object({certificateId:z.string().min(4).max(200)}).parse(q.body);
  const {data:org,error:orgError}=await q.supabase.from("Organization").select("id,name,type,status").eq("ownerId",q.user.id).maybeSingle();
  if(orgError)throw orgError;
  if(!org||org.status!=="APPROVED"||!(await hasApprovedOrganizationCapability(q.supabase,org.id,"ISSUE_CREDENTIALS")))return s.status(403).json({error:"Only an approved credential issuer can verify its own issued certificates."});
  const reference=b.certificateId.trim();
  const fields="id,certificateId,verificationKey,studentName,studentNumber,institution,faculty,department,programme,qualification,classification,awardDate,issuedAt,digest,txHash,status,organizationId";
  let {data:c,error}=await q.supabase.from("Certificate").select(fields).eq("organizationId",org.id).eq("certificateId",reference).maybeSingle();
  if(error)throw error;
  if(!c){const result=await q.supabase.from("Certificate").select(fields).eq("organizationId",org.id).eq("verificationKey",reference.toUpperCase()).maybeSingle();c=result.data;error=result.error;if(error)throw error;}
  if(!c)return s.status(404).json({verified:false,status:"NOT_FOUND",message:"This certificate reference was not found in your institution's own issuance records."});
  const recomputed=digest(canonical(c)),dbOk=recomputed===c.digest,chain=await verifyCertificateChain(c);
  const chainOk=!chain.enabled||(chain.exists===true&&chain.digest?.toLowerCase()===recomputed.toLowerCase()&&!chain.revoked);
  const verified=c.status==="ACTIVE"&&dbOk&&chainOk;
  const status=c.status==="REVOKED"||chain.revoked?"REVOKED":verified?"VERIFIED":"INTEGRITY_MISMATCH";
  await audit(q.supabase,q.user.id,"INSTITUTION_CERTIFICATE_VERIFIED","Certificate",c.id,{certificateId:c.certificateId,organizationId:org.id,status});
  const issuer=await publicIssuerDetails(q.supabase,c.certificateId);
  s.json({verified,status,issuer,message:verified?"This certificate matches the academic record issued by your institution.":status==="REVOKED"?"Your institution has revoked this certificate.":"The certificate record's integrity check did not match.",certificate:{certificateId:c.certificateId,verificationKey:c.verificationKey,studentName:c.studentName,institution:c.institution,qualification:c.qualification,awardDate:c.awardDate,issuedAt:c.issuedAt,digest:c.digest,txHash:c.txHash,status:c.status},verifierOrganization:org.name,chain:chain.enabled?{enabled:true,exists:chain.exists,network:"Polygon Amoy",chainId:chain.chainId,contractAddress:chain.contractAddress}:{enabled:false,note:"Supabase PostgreSQL certificate ledger; on-chain verification is not active."}});
}));

app.post("/api/organization/verify",createVerificationRateLimiter({windowMs:60_000,limit:20}),auth,roles("EMPLOYER"),run(async(q,s)=>{
  const b=z.object({certificateId:z.string().min(4)}).parse(q.body);
  const {data:org,error:orgError}=await q.supabase.from("Organization").select("id,name,type,status").eq("ownerId",q.user.id).maybeSingle();
  if(orgError)throw orgError;
  if(!org||org.status!=="APPROVED"||!(await hasApprovedOrganizationCapability(q.supabase,org.id,"VERIFY_CREDENTIALS")))return s.status(403).json({error:"Your organization does not have an approved external-verification capability."});
  const {data,error}=await q.supabase.rpc("lookup_verity_certificate_for_org",{p_certificate_id:b.certificateId.trim()});
  if(error)throw error;
  if(!data?.found)return s.status(404).json({verified:false,status:"NOT_FOUND",message:"No credential with this ID or verification key exists in the VERITY registry."});
  const c=data,recomputed=digest(canonical(c)),dbOk=recomputed===c.digest,chain=await verifyCertificateChain(c);
  if(!SUPABASE_SERVER_KEY)return s.status(503).json({error:"Secure server-side ledger verification is not configured."});
  const serverClient=makeServerClient();
  const {data:ledgerRows,error:ledgerError}=await serverClient.rpc("verify_verity_certificate_ledger_record",{p_certificate_id:c.certificateId});
  if(ledgerError)throw ledgerError;
  const ledger=Array.isArray(ledgerRows)?ledgerRows[0]:ledgerRows;
  const ledgerOk=ledger?.ledger_valid===true&&Number(ledger?.event_count||0)>0&&ledger?.record_matches===true;
  const chainOk=!chain.enabled||(chain.exists===true&&chain.digest?.toLowerCase()===recomputed.toLowerCase()&&!chain.revoked);
  const verified=c.status==="ACTIVE"&&dbOk&&ledgerOk&&chainOk;
  const status=c.status==="REVOKED"||chain.revoked?"REVOKED":verified?"VERIFIED":"INTEGRITY_MISMATCH";
  await audit(q.supabase,q.user.id,"ORGANIZATION_CERTIFICATE_VERIFIED","Certificate",c.id,{certificateId:c.certificateId,organizationId:org.id,status,ledgerValid:ledgerOk,recordMatches:ledger?.record_matches===true});
  await createVerityNotification(q.user.id,{type:"VERIFICATION_COMPLETED",category:"VERIFICATION",title:status==="VERIFIED"?"Credential verification completed":"Credential verification needs attention",body:c.certificateId+" · "+status.replaceAll("_"," ").toLowerCase()+".",url:"/verify",metadata:{certificateId:c.certificateId,status}});
  if(status==="INTEGRITY_MISMATCH")await notifyVerityAdmins({type:"VERIFICATION_ALERT",category:"PLATFORM",title:"Credential integrity verification alert",body:"An organization verification returned an integrity mismatch for "+c.certificateId+".",url:"/activity",metadata:{certificateId:c.certificateId,organizationId:org.id}});
  const issuer=await publicIssuerDetails(serverClient,c.certificateId);
  const message=verified?"Credential record and Supabase ledger match the issuing institution's registered record.":status==="REVOKED"?"The issuing institution has revoked this credential.":!dbOk?"The academic record fingerprint does not match its issued digest.":!ledgerOk?"The Supabase ledger or its latest certificate event could not be validated.":"The blockchain fingerprint does not match the registered record.";
  s.json({verified,status,issuer,message,integrity:dbOk&&ledgerOk?"SUPABASE_RECORD_AND_LEDGER_MATCH":"DATABASE_LEDGER_INTEGRITY_FAILED",ledger:{valid:ledgerOk,recordMatches:ledger?.record_matches===true,eventCount:Number(ledger?.event_count||0),latestEvent:ledger?.latest_event||null,headHash:ledger?.head_hash||null},certificate:{certificateId:c.certificateId,verificationKey:c.verificationKey,studentName:c.studentName,studentNumber:c.studentNumber,institution:c.institution,faculty:c.faculty,department:c.department,programme:c.programme,qualification:c.qualification,classification:c.classification,awardDate:c.awardDate,issuedAt:c.issuedAt,digest:c.digest,txHash:c.txHash,status:c.status},verifierOrganization:org.name,chain:chain.enabled?{enabled:true,exists:chain.exists,network:"Polygon Amoy",chainId:chain.chainId,contractAddress:chain.contractAddress}:{enabled:false,note:"Supabase PostgreSQL certificate ledger; on-chain verification is not active."}});
}));

app.post("/api/organization/student-lookup",createVerificationRateLimiter({windowMs:60_000,limit:15}),auth,roles("EMPLOYER"),run(async(q,res)=>{
  const b=z.object({studentName:z.string().min(2).max(120),studentNumber:z.string().min(2).max(80),institution:z.string().min(2).max(160),department:z.string().min(2).max(160)}).parse(q.body);
  const {data:org,error:oe}=await q.supabase.from("Organization").select("id,type,status").eq("ownerId",q.user.id).maybeSingle();
  if(oe)throw oe;
  if(!org||org.status!=="APPROVED"||!(await hasApprovedOrganizationCapability(q.supabase,org.id,"VERIFY_CREDENTIALS")))return res.status(403).json({error:"Your organization does not have an approved external-verification capability."});
  const {data,error}=await q.supabase.from("Certificate").select("certificateId,studentName,studentNumber,institution,department,status,graduateId").eq("studentNumber",b.studentNumber.trim()).eq("studentName",b.studentName.trim()).eq("institution",b.institution.trim()).eq("department",b.department.trim()).limit(5);
  if(error)throw error;
  const matches=(data||[]).map(c=>({certificateId:c.certificateId,studentName:c.studentName,studentNumber:c.studentNumber,institution:c.institution,department:c.department,status:c.status,requestable:!!c.graduateId}));
  await audit(q.supabase,q.user.id,"ORGANIZATION_STUDENT_LOOKUP","Certificate",null,{organizationId:org.id,matchCount:matches.length});
  res.json({matches});
}));

app.post("/api/organization/access-requests",auth,roles("EMPLOYER"),run(async(q,s)=>{
  const b=z.object({certificateId:z.string().min(4),purpose:z.string().min(5).max(300).optional()}).parse(q.body);
  const {data:org,error:oe}=await q.supabase.from("Organization").select("id,name,type,status").eq("ownerId",q.user.id).maybeSingle();
  if(oe)throw oe;if(!org||org.status!=="APPROVED"||!(await hasApprovedOrganizationCapability(q.supabase,org.id,"VERIFY_CREDENTIALS")))return s.status(403).json({error:"Your organization does not have an approved external-verification capability."});
  const {data:cert,error:ce}=await q.supabase.from("Certificate").select("id,certificateId,graduateId").or("certificateId.eq."+b.certificateId+",verificationKey.eq."+b.certificateId.toUpperCase()).maybeSingle();
  if(ce)throw ce;if(!cert)return s.status(404).json({error:"Certificate not found."});
  if(!cert.graduateId)return s.status(409).json({error:"The graduate must link their Verity account to this certificate before private document access can be requested."});
  const {data:existing,error:ee}=await q.supabase.from("CertificateAccessGrant").select("id,status,expiresAt").eq("certificateId",cert.id).eq("organizationId",org.id).in("status",["PENDING","APPROVED"]).order("createdAt",{ascending:false}).limit(1).maybeSingle();
  if(ee)throw ee;
  if(existing?.status==="PENDING")return s.status(200).json({grant:existing,message:"An access request is already awaiting the graduate’s decision."});
  if(isCertificateAccessActive(existing))return s.status(200).json({grant:existing,message:"This organization already has active graduate-approved access to this certificate."});
  const {data:grant,error}=await q.supabase.from("CertificateAccessGrant").insert({id:crypto.randomUUID(),certificateId:cert.id,graduateId:cert.graduateId,organizationId:org.id,requestedBy:q.user.id,purpose:b.purpose||"Employment or academic credential verification",status:"PENDING"}).select().single();
  if(error)throw error;
  await audit(q.supabase,q.user.id,"CERTIFICATE_ACCESS_REQUESTED","CertificateAccessGrant",grant.id,{certificateId:cert.certificateId,organizationId:org.id});
  await createVerityNotification(cert.graduateId,{type:"ACCESS_REQUESTED",category:"ACCESS",title:"Certificate access requested",body:org.name+" requested permission to view your original certificate.",url:"/access",metadata:{grantId:grant.id,certificateId:cert.certificateId}});
  await notifyVerityAdmins({type:"ACCESS_REQUESTED",category:"PLATFORM",title:"New certificate access request",body:org.name+" requested access to a graduate certificate.",url:"/access",metadata:{grantId:grant.id}});
  s.status(201).json({grant,message:"The graduate must approve access before the original document can be viewed."});
}));

app.get("/api/organization/access-requests",auth,roles("EMPLOYER"),run(async(q,s)=>{
  const {data:org,error:oe}=await q.supabase.from("Organization").select("id,type,status").eq("ownerId",q.user.id).maybeSingle();
  if(oe)throw oe;if(!org||org.status!=="APPROVED"||!(await hasApprovedOrganizationCapability(q.supabase,org.id,"VERIFY_CREDENTIALS")))return s.status(403).json({error:"Only an organization with approved verifier permission can view its access requests."});
  const {data,error}=await q.supabase.from("CertificateAccessGrant").select("id,certificateId,graduateId,purpose,status,createdAt,approvedAt,expiresAt,revokedAt").eq("organizationId",org.id).order("createdAt",{ascending:false});
  if(error)throw error;
  const ids=(data||[]).map(x=>x.certificateId);
  const {data:certs,error:ce}=ids.length?await q.supabase.from("Certificate").select("id,certificateId,studentName,institution,qualification").in("id",ids):{data:[],error:null};
  if(ce)throw ce;
  s.json({requests:(data||[]).map(x=>({...x,certificate:(certs||[]).find(c=>c.id===x.certificateId)||null}))});
}));

app.get("/api/graduate/access-requests",auth,roles("GRADUATE"),run(async(q,s)=>{
  const {data,error}=await q.supabase.from("CertificateAccessGrant").select("id,certificateId,organizationId,purpose,status,createdAt,approvedAt,expiresAt,revokedAt,Organization:organizationId(name,type,registrationNumber,officialWebsite,officialEmailDomain,accreditationBody,verifiedAt,locationCity,locationState,locationCountry)").eq("graduateId",q.user.id).order("createdAt",{ascending:false});
  if(error)throw error;
  const ids=(data||[]).map(x=>x.certificateId);
  const {data:certs,error:ce}=ids.length?await q.supabase.from("Certificate").select("id,certificateId,studentName,institution,qualification").in("id",ids):{data:[],error:null};
  if(ce)throw ce;
  s.json({requests:(data||[]).map(x=>({...x,certificate:(certs||[]).find(c=>c.id===x.certificateId)||null}))});
}));

app.patch("/api/graduate/access-requests/:id",auth,roles("GRADUATE"),run(async(q,s)=>{
  const b=z.object({status:z.enum(["APPROVED","REJECTED","REVOKED"])}).parse(q.body);
  const now=new Date().toISOString();
  const patch=b.status==="APPROVED"?{status:"APPROVED",updatedAt:now,approvedAt:now,expiresAt:new Date(Date.now()+30*24*60*60*1000).toISOString()}:b.status==="REJECTED"?{status:"REJECTED",updatedAt:now,approvedAt:null,expiresAt:null}:{status:"REVOKED",updatedAt:now,revokedAt:now,revokedBy:q.user.id};
  let update=q.supabase.from("CertificateAccessGrant").update(patch).eq("id",q.params.id).eq("graduateId",q.user.id);
  if(b.status==="REVOKED")update=update.eq("status","APPROVED").gt("expiresAt",now);else update=update.eq("status","PENDING");
  const {data,error}=await update.select().maybeSingle();
  if(error)throw error;
  if(!data)return s.status(409).json({error:b.status==="REVOKED"?"This access grant is no longer active or has already expired.":"This request has already been decided."});
  await audit(q.supabase,q.user.id,"CERTIFICATE_ACCESS_"+b.status,"CertificateAccessGrant",data.id,{organizationId:data.organizationId,expiresAt:data.expiresAt,revokedAt:data.revokedAt||null});
  const {data:org}=await q.supabase.from("Organization").select("ownerId,name").eq("id",data.organizationId).maybeSingle();
  if(org?.ownerId)await createVerityNotification(org.ownerId,{type:"ACCESS_DECISION",category:"ACCESS",title:b.status==="APPROVED"?"Certificate access approved":b.status==="REVOKED"?"Certificate access revoked":"Certificate access declined",body:b.status==="REVOKED"?"The graduate has revoked access to the original certificate.":"Your request to access a graduate certificate was "+b.status.toLowerCase()+".",url:"/access",metadata:{grantId:data.id,status:b.status,expiresAt:data.expiresAt,revokedAt:data.revokedAt||null}});
  s.json({grant:data});
}));

app.get("/api/organization/access-requests/:id/document",auth,roles("EMPLOYER"),run(async(q,s)=>{
  const {data:org,error:oe}=await q.supabase.from("Organization").select("id,type,status").eq("ownerId",q.user.id).maybeSingle();
  if(oe)throw oe;
  if(!org||org.status!=="APPROVED"||!(await hasApprovedOrganizationCapability(q.supabase,org.id,"VERIFY_CREDENTIALS")))return s.status(403).json({error:"Only an organization with approved verifier permission can access shared documents."});
  const {data:grant,error:ge}=await q.supabase.from("CertificateAccessGrant").select("id,certificateId,status,expiresAt").eq("id",q.params.id).eq("organizationId",org.id).maybeSingle();
  if(ge)throw ge;
  if(!isCertificateAccessActive(grant))return s.status(403).json({error:"The graduate has not approved access, or the approval has expired."});
  const {data:credential,error:credentialError}=await q.supabase.from("Certificate").select("id,status").eq("id",grant.certificateId).maybeSingle();
  if(credentialError)throw credentialError;
  if(!credential||credential.status!=="ACTIVE")return s.status(410).json({error:"This certificate is no longer active. Shared document access has been stopped."});
  const {data:doc,error:de}=await q.supabase.from("CertificateDocument").select("id,storagePath,originalName,mimeType,sha256,scanStatus").eq("certificateId",grant.certificateId).order("createdAt",{ascending:false}).limit(1).maybeSingle();
  if(de)throw de;
  if(!doc)return s.status(404).json({error:"The institution has not uploaded an original certificate document yet."});
  const {data:file,error:fe}=await q.supabase.storage.from("verity-certificates").download(doc.storagePath);
  if(fe)throw fe;
  const bytes=Buffer.from(await file.arrayBuffer());
  if(!doc.sha256||digest(bytes)!==doc.sha256)return s.status(409).json({error:"Document integrity check failed. The stored file does not match its registered SHA-256 fingerprint."});
  await audit(q.supabase,q.user.id,"SHARED_CERTIFICATE_DOCUMENT_VIEWED","CertificateDocument",doc.id,{organizationId:org.id,grantId:grant.id,scanStatus:doc.scanStatus});
  s.setHeader("Content-Type",doc.mimeType);
  s.setHeader("Content-Disposition",`inline; filename="verity-certificate-preview.${doc.mimeType==="application/pdf"?"pdf":doc.mimeType==="image/png"?"png":"jpg"}"`);
  s.setHeader("Cache-Control","private, no-store, max-age=0");
  s.setHeader("Pragma","no-cache");
  s.setHeader("X-Content-Type-Options","nosniff");
  s.setHeader("Content-Security-Policy","sandbox; default-src 'none'; img-src 'self' data:");
  s.status(200).send(bytes);
}));

app.get("/api/organization/access-requests/:id/document/download",auth,roles("EMPLOYER"),run(async(q,s)=>{
  const {data:org,error:oe}=await q.supabase.from("Organization").select("id,name,type,status").eq("ownerId",q.user.id).maybeSingle();
  if(oe)throw oe;
  if(!org||org.status!=="APPROVED"||!(await hasApprovedOrganizationCapability(q.supabase,org.id,"VERIFY_CREDENTIALS")))return s.status(403).json({error:"Only an organization with approved verifier permission can download shared documents."});
  const {data:grant,error:ge}=await q.supabase.from("CertificateAccessGrant").select("id,certificateId,status,expiresAt").eq("id",q.params.id).eq("organizationId",org.id).maybeSingle();
  if(ge)throw ge;
  if(!isCertificateAccessActive(grant))return s.status(403).json({error:"The graduate has not approved access, or the approval has expired."});
  const {data:credential,error:credentialError}=await q.supabase.from("Certificate").select("id,status").eq("id",grant.certificateId).maybeSingle();
  if(credentialError)throw credentialError;
  if(!credential||credential.status!=="ACTIVE")return s.status(410).json({error:"This certificate is no longer active. Shared document access has been stopped."});
  const {data:doc,error:de}=await q.supabase.from("CertificateDocument").select("id,storagePath,originalName,mimeType,sha256,scanStatus").eq("certificateId",grant.certificateId).order("createdAt",{ascending:false}).limit(1).maybeSingle();
  if(de)throw de;
  if(!doc)return s.status(404).json({error:"The institution has not uploaded an original certificate document yet."});
  const {data:file,error:fe}=await q.supabase.storage.from("verity-certificates").download(doc.storagePath);
  if(fe)throw fe;
  const source=Buffer.from(await file.arrayBuffer());
  if(!doc.sha256||digest(source)!==doc.sha256)return s.status(409).json({error:"Document integrity check failed. The stored file does not match its registered SHA-256 fingerprint."});
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

app.post("/api/verify",createVerificationRateLimiter(),run(async(q,s)=>{
  const b=z.object({certificateId:z.string().min(4),verifierName:z.string().optional(),verifierOrg:z.string().optional()}).parse(q.body);
  if(!SUPABASE_SERVER_KEY)return s.status(503).json({verified:false,status:"SERVICE_UNAVAILABLE",message:"Secure server-side certificate verification is not configured."});
  const client=makeServerClient();
  const {data,error}=await client.rpc("lookup_verity_certificate",{p_certificate_id:b.certificateId.trim(),p_verifier_name:b.verifierName||null,p_verifier_org:b.verifierOrg||null});
  if(error)throw error;
  if(!data?.found)return s.status(404).json({verified:false,status:"NOT_FOUND",message:"No credential with this ID exists in the registry."});
  const c=data,dbOk=digest(canonical(c))===String(c.digest||""),chain=await verifyCertificateChain(c);
  const {data:ledgerRows,error:ledgerError}=await client.rpc("verify_verity_certificate_ledger_record",{p_certificate_id:c.certificateId});
  if(ledgerError)throw ledgerError;
  const ledger=Array.isArray(ledgerRows)?ledgerRows[0]:ledgerRows;
  const ledgerOk=ledger?.ledger_valid===true&&Number(ledger?.event_count||0)>0&&ledger?.record_matches===true;
  const chainOk=!chain.enabled||(chain.exists===true&&chain.digest?.toLowerCase()===String(c.digest||"").toLowerCase()&&!chain.revoked);
  const verified=c.status==="ACTIVE"&&dbOk&&ledgerOk&&chainOk;
  const status=c.status==="REVOKED"||chain.revoked?"REVOKED":verified?"VERIFIED":"INTEGRITY_MISMATCH";
  const issuer=await publicIssuerDetails(client,c.certificateId);
  const message=verified?(chain.enabled?"Credential record, Supabase ledger and blockchain fingerprint match.":"Credential record and its Supabase hash-chained ledger match.") :status==="REVOKED"?"This credential has been revoked by its issuing institution.":!dbOk?"The academic record fingerprint does not match its issued digest.":!ledgerOk?"The Supabase ledger or its latest certificate event could not be validated.":"The blockchain fingerprint does not match the registered record.";
  s.json({verified,status,issuer,message,integrity:chain.enabled&&dbOk&&ledgerOk?"BLOCKCHAIN_AND_DATABASE_LEDGER_MATCH":dbOk&&ledgerOk?"SUPABASE_RECORD_AND_LEDGER_MATCH":"DATABASE_LEDGER_INTEGRITY_FAILED",ledger:{valid:ledgerOk,recordMatches:ledger?.record_matches===true,eventCount:Number(ledger?.event_count||0),latestEvent:ledger?.latest_event||null,headHash:ledger?.head_hash||null},certificate:{certificateId:c.certificateId,verificationKey:c.verificationKey,studentName:c.studentName,institution:c.institution,qualification:c.qualification,awardDate:c.awardDate,issuedAt:c.issuedAt,digest:c.digest,txHash:c.txHash,status:c.status},chain:chain.enabled?{enabled:true,exists:chain.exists,network:"Polygon Amoy",chainId:chain.chainId,contractAddress:chain.contractAddress,issuer:chain.issuer,issuedAt:chain.issuedAt}:{enabled:false,note:"Supabase append-only certificate ledger with SHA-256 hash chaining. Polygon anchoring remains an optional future enhancement."}});
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
      const serverClient=makeServerClient();
      const {data:record,error}=await serverClient.rpc("lookup_verity_certificate",{p_certificate_id:certificate.verificationKey,p_verifier_name:null,p_verifier_org:null});
      if(error) throw error;
      if(!record?.found){
        verification={verified:false,status:"NOT_FOUND",message:"The live registry did not return this credential."};
      }else{
        const dbOk=digest(canonical(record))===String(record.digest||"");
        const {data:ledgerRows,error:ledgerError}=await serverClient.rpc("verify_verity_certificate_ledger_record",{p_certificate_id:record.certificateId});
        if(ledgerError)throw ledgerError;
        const ledger=Array.isArray(ledgerRows)?ledgerRows[0]:ledgerRows;
        const ledgerOk=ledger?.ledger_valid===true&&Number(ledger?.event_count||0)>0&&ledger?.record_matches===true;
        const chain=await verifyCertificateChain(record);
        const chainOk=!chain.enabled||(chain.exists===true&&chain.digest?.toLowerCase()===String(record.digest||"").toLowerCase()&&!chain.revoked);
        const verified=record.status==="ACTIVE"&&dbOk&&ledgerOk&&chainOk;
        verification={verified,status:record.status==="REVOKED"||chain.revoked?"REVOKED":verified?"VERIFIED":"INTEGRITY_MISMATCH",ledgerValid:ledgerOk,recordMatches:ledger?.record_matches===true};
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



app.post("/api/issues/:id/attachments",auth,express.raw({type:"application/octet-stream",limit:"10mb"}),run(async(q,s)=>{
 const fileName=decodeURIComponent(String(q.headers["x-file-name"]||"attachment")).normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,120)||"attachment";
 const mimeType=String(q.headers["x-file-type"]||"application/octet-stream").toLowerCase();
 const allowed=new Set(["image/jpeg","image/png","image/webp","application/pdf","text/plain","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);
 if(!allowed.has(mimeType))return s.status(415).json({error:"This file type is not supported. Upload an image, PDF, text, Word or Excel document."});
 if(!Buffer.isBuffer(q.body)||!q.body.length)return s.status(400).json({error:"Choose a file before uploading."});
 const {data:issue,error:issueError}=await q.supabase.from("IssueReport").select("id,status").eq("id",q.params.id).maybeSingle();
 if(issueError)throw issueError;
 if(!issue||issue.status==="CLOSED")return s.status(404).json({error:"This conversation is unavailable or closed."});
 const id=crypto.randomUUID(),objectPath=q.params.id+"/"+q.user.id+"/"+id+"-"+fileName;
 const {data,error}=await q.supabase.storage.from("verity-support-attachments").upload(objectPath,q.body,{contentType:mimeType,upsert:false});
 if(error)throw error;
 s.status(201).json({attachment:{path:data.path,fileName,size:q.body.length,mimeType}});
}));
app.get("/api/issues/:id/attachments",auth,run(async(q,s)=>{
 const objectPath=String(q.query.path||"");
 if(!objectPath.startsWith(q.params.id+"/")||objectPath.split("/").length!==3)return s.status(400).json({error:"Invalid attachment reference."});
 const {data,error}=await q.supabase.storage.from("verity-support-attachments").createSignedUrl(objectPath,300);
 if(error)throw error;
 s.json({url:data.signedUrl,expiresIn:300});
}));

async function sendVerityPush(userIds,payload){
 if(!SUPABASE_SERVER_KEY||!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY)return;
 try{
  const webpush=(await import("web-push")).default;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT||"mailto:admin@verity.local",process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
  const adminDb=createClient(SUPABASE_URL,SUPABASE_SERVER_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:rows}=await adminDb.from("PushSubscription").select("id,userId,subscription").in("userId",userIds);
  await Promise.all((rows||[]).map(async row=>{try{await webpush.sendNotification(row.subscription,JSON.stringify(payload));}catch(err){if(err.statusCode===404||err.statusCode===410)await adminDb.from("PushSubscription").delete().eq("id",row.id);}}));
 }catch(err){console.error("VERITY push delivery:",err.message);}
}

app.get("/api/notifications",auth,run(async(q,s)=>{
 const [itemsResult,prefsResult]=await Promise.all([
  q.supabase.from("Notification").select("id,type,category,title,body,url,metadata,readAt,createdAt").eq("userId",q.user.id).order("createdAt",{ascending:false}).limit(100),
  q.supabase.from("NotificationPreference").select("category,inAppEnabled,pushEnabled,emailEnabled").eq("userId",q.user.id)
 ]);
 if(itemsResult.error)throw itemsResult.error;if(prefsResult.error)throw prefsResult.error;
 s.json({notifications:itemsResult.data||[],unreadCount:(itemsResult.data||[]).filter(n=>!n.readAt).length,preferences:prefsResult.data||[]});
}));
app.patch("/api/notifications/:id/read",auth,run(async(q,s)=>{
 const now=new Date().toISOString();
 const {data,error}=await q.supabase.from("Notification").update({readAt:now}).eq("id",q.params.id).eq("userId",q.user.id).is("readAt",null).select("id,readAt").maybeSingle();
 if(error)throw error;s.json({notification:data});
}));
app.post("/api/notifications/read-all",auth,run(async(q,s)=>{
 const now=new Date().toISOString();
 const {error}=await q.supabase.from("Notification").update({readAt:now}).eq("userId",q.user.id).is("readAt",null);
 if(error)throw error;s.json({markedRead:true});
}));
app.put("/api/notifications/preferences",auth,run(async(q,s)=>{
 const b=z.object({preferences:z.array(z.object({category:z.enum(["ACCOUNT","CERTIFICATE","VERIFICATION","ACCESS","SUPPORT","PLATFORM"]),inAppEnabled:z.boolean(),pushEnabled:z.boolean(),emailEnabled:z.boolean() })).max(6)}).parse(q.body);
 const rows=b.preferences.map(p=>({id:crypto.randomUUID(),userId:q.user.id,...p,updatedAt:new Date().toISOString()}));
 const {error}=await q.supabase.from("NotificationPreference").upsert(rows,{onConflict:"userId,category"});
 if(error)throw error;s.json({saved:true});
}));

app.get("/api/push/config",auth,(_q,s)=>s.json({publicKey:process.env.VAPID_PUBLIC_KEY||null}));
app.post("/api/push/subscribe",auth,run(async(q,s)=>{
 const b=z.object({subscription:z.object({endpoint:z.string().url(),keys:z.object({p256dh:z.string(),auth:z.string()})})}).parse(q.body);
 const {error}=await q.supabase.from("PushSubscription").upsert({userId:q.user.id,endpoint:b.subscription.endpoint,subscription:b.subscription,updatedAt:new Date().toISOString()},{onConflict:"userId,endpoint"});
 if(error)throw error;
 s.status(201).json({enabled:true});
}));
app.delete("/api/push/subscribe",auth,run(async(q,s)=>{
 const endpoint=String(q.body?.endpoint||"");
 if(!endpoint)return s.status(400).json({error:"Subscription endpoint is required."});
 const {error}=await q.supabase.from("PushSubscription").delete().eq("userId",q.user.id).eq("endpoint",endpoint);
 if(error)throw error;s.json({enabled:false});
}));
app.get("/api/admin/users",auth,roles("ADMIN"),run(async(q,s)=>{
 if(!SUPABASE_SERVER_KEY)return s.status(503).json({error:"Admin directory requires SUPABASE_SERVICE_ROLE_KEY on the server."});
 const db=SUPABASE_SERVER_KEY?createClient(SUPABASE_URL,SUPABASE_SERVER_KEY,{auth:{persistSession:false,autoRefreshToken:false}}):q.supabase;
 const {data,error}=await db.from("User").select("id,fullName,email,role").order("fullName").limit(1000);
 if(error)throw error;
 s.json({users:data||[]});
}));
app.patch("/api/issues/:id/assignment",auth,roles("ADMIN"),run(async(q,s)=>{
 if(!SUPABASE_SERVER_KEY)return s.status(503).json({error:"Admin assignment requires SUPABASE_SERVICE_ROLE_KEY on the server."});
 const adminDb=createClient(SUPABASE_URL,SUPABASE_SERVER_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const b=z.object({assignedTo:z.string().nullable()}).parse(q.body);
 if(b.assignedTo){
  const {data:admin,error}=await adminDb.from("User").select("id,fullName,role").eq("id",b.assignedTo).maybeSingle();
  if(error)throw error;if(!admin||admin.role!=="ADMIN")return s.status(400).json({error:"Choose a registered VERITY administrator."});
 }
 const {data,error}=await q.supabase.from("IssueReport").update({assignedTo:b.assignedTo,updatedAt:new Date().toISOString()}).eq("id",q.params.id).select("id,assignedTo,updatedAt").maybeSingle();
 if(error)throw error;if(!data)return s.status(404).json({error:"Conversation not found."});
 await audit(q.supabase,q.user.id,"ISSUE_REPORT_ASSIGNED","IssueReport",data.id,{assignedTo:b.assignedTo});
 s.json({issue:data});
}));
app.post("/api/issues/:id/read",auth,run(async(q,s)=>{
 const now=new Date().toISOString();
 const {error}=await q.supabase.from("IssueReadState").upsert({issueId:q.params.id,userId:q.user.id,lastReadAt:now,updatedAt:now},{onConflict:"issueId,userId"});
 if(error)throw error;s.json({lastReadAt:now});
}));
app.post("/api/admin/broadcast-email",auth,roles("ADMIN"),run(async(q,s)=>{
 if(!SUPABASE_SERVER_KEY)return s.status(503).json({error:"All-user broadcast requires SUPABASE_SERVICE_ROLE_KEY on the server."});
 const b=z.object({subject:z.string().trim().min(3).max(180),message:z.string().trim().min(10).max(12000)}).parse(q.body);
 const required=["SMTP_HOST","SMTP_PORT","SMTP_USER","SMTP_PASS","SMTP_FROM"];
 if(required.some(k=>!process.env[k]))return s.status(503).json({error:"Broadcast email is not configured yet. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM to the VERITY Render environment."});
 const db=SUPABASE_SERVER_KEY?createClient(SUPABASE_URL,SUPABASE_SERVER_KEY,{auth:{persistSession:false,autoRefreshToken:false}}):q.supabase;
 const {data:users,error}=await db.from("User").select("email,fullName").limit(5000);
 if(error)throw error;
 const recipients=[...new Map((users||[]).filter(u=>u.email).map(u=>[u.email.toLowerCase(),u])).values()];
 if(!recipients.length)return s.status(400).json({error:"There are no registered email recipients."});
 const nodemailer=(await import("nodemailer")).default;
 const transporter=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT),secure:String(process.env.SMTP_SECURE||"false")==="true",auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
 const html="<div style=\"font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#233747;line-height:1.65\"><div style=\"background:#101d35;color:white;padding:22px 26px;font-size:22px;font-weight:700\">VERITY</div><div style=\"padding:26px\"><h2>"+b.subject.replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]))+"</h2><p>"+b.message.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>")+"</p><hr><small>You're receiving this message because you have a VERITY account.</small></div></div>";
 let sent=0,failed=0;
 for(let offset=0;offset<recipients.length;offset+=10){
  const batch=recipients.slice(offset,offset+10);
  const results=await Promise.allSettled(batch.map(u=>transporter.sendMail({from:process.env.SMTP_FROM,to:u.email,subject:b.subject,text:b.message,html})));
  sent+=results.filter(x=>x.status==="fulfilled").length;failed+=results.length-(results.filter(x=>x.status==="fulfilled").length);
 }
 await audit(q.supabase,q.user.id,"ADMIN_BROADCAST_EMAIL_SENT","Platform",null,{recipientCount:recipients.length,sent,failed,subject:b.subject});
 s.json({total:recipients.length,sent,failed});
}));
app.get("/api/issues/:id/messages",auth,run(async(q,s)=>{
 const {data:messages,error}=await q.supabase.from("IssueMessage").select("id,issueId,authorId,authorName,authorRole,body,attachments,createdAt").eq("issueId",q.params.id).order("createdAt",{ascending:true}).limit(300);
 if(error)throw error;
 s.json({messages:messages||[]});
}));
app.post("/api/issues/:id/messages",auth,run(async(q,s)=>{
 const b=z.object({body:z.string().trim().min(1).max(5000),attachments:z.array(z.object({path:z.string().min(1).max(500),fileName:z.string().min(1).max(120),size:z.number().int().positive().max(10485760),mimeType:z.string().max(120)})).max(5).default([])}).parse(q.body);
 if(b.attachments.some(a=>!a.path.startsWith(q.params.id+"/"+q.user.id+"/")||a.path.split("/").length!==3))return s.status(400).json({error:"An attachment does not belong to this conversation and uploader."});
 const {data,error}=await q.supabase.from("IssueMessage").insert({id:crypto.randomUUID(),issueId:q.params.id,authorId:q.user.id,authorName:q.user.fullName||"VERITY user",authorRole:q.user.role,body:b.body,attachments:b.attachments,createdAt:new Date().toISOString()}).select("id,issueId,authorId,authorName,authorRole,body,createdAt").single();
 if(error)throw error;
 await audit(q.supabase,q.user.id,"ISSUE_MESSAGE_SENT","IssueReport",q.params.id,{messageId:data.id});
 const {data:issue}=await q.supabase.from("IssueReport").select("id,reporterId,assignedTo,subject").eq("id",q.params.id).maybeSingle();
 if(issue){
  const payload={type:"SUPPORT_REPLY",category:"SUPPORT",title:"New support conversation reply",body:(issue.subject||"Support conversation")+" — "+(q.user.fullName||"A participant")+" sent a message.",url:"/issues",metadata:{issueId:q.params.id}};
  if(q.user.role==="ADMIN"){if(issue.reporterId)await createVerityNotification(issue.reporterId,payload);}
  else{
   if(issue.assignedTo&&issue.assignedTo!==q.user.id)await createVerityNotification(issue.assignedTo,payload);
   await notifyVerityAdmins(payload);
  }
 }
 s.status(201).json({message:data});
}));
app.get("/api/issues",auth,run(async(q,s)=>{
  const {data,error}=await q.supabase.from("IssueReport").select("id,ticketNumber,reporterId,organizationId,category,severity,subject,description,status,resolutionNotes,assignedTo,createdAt,updatedAt,resolvedAt").order("createdAt",{ascending:false}).limit(100);
  if(error)throw error;
  const orgIds=[...new Set((data||[]).map(x=>x.organizationId).filter(Boolean))];
  const {data:orgs,error:orgError}=orgIds.length?await q.supabase.from("Organization").select("id,name,type").in("id",orgIds):{data:[],error:null};
  if(orgError)throw orgError;
  const issueIds=(data||[]).map(x=>x.id);
  const [{data:reads,error:readError},{data:messages,error:messageError},{data:admins,error:adminError}]=await Promise.all([
   issueIds.length?q.supabase.from("IssueReadState").select("issueId,lastReadAt").eq("userId",q.user.id).in("issueId",issueIds):Promise.resolve({data:[],error:null}),
   issueIds.length?q.supabase.from("IssueMessage").select("issueId,authorId,createdAt").in("issueId",issueIds).neq("authorId",q.user.id).order("createdAt",{ascending:false}).limit(1000):Promise.resolve({data:[],error:null}),
   q.user.role==="ADMIN"?q.supabase.from("User").select("id,fullName,role").eq("role","ADMIN"):Promise.resolve({data:[],error:null})
  ]);
  if(readError)throw readError;if(messageError)throw messageError;if(adminError)throw adminError;
  const readMap=new Map((reads||[]).map(x=>[x.issueId,x.lastReadAt]));
  const unreadMap=new Map();
  for(const m of messages||[])if(!readMap.has(m.issueId)||new Date(m.createdAt)>new Date(readMap.get(m.issueId)))unreadMap.set(m.issueId,(unreadMap.get(m.issueId)||0)+1);
  s.json({issues:(data||[]).map(x=>({...x,organization:(orgs||[]).find(o=>o.id===x.organizationId)||null,assignedAdmin:(admins||[]).find(a=>a.id===x.assignedTo)||null,unreadCount:unreadMap.get(x.id)||0}))});
}));
app.post("/api/issues",auth,run(async(q,s)=>{
  const b=z.object({category:z.enum(["ACCOUNT","CERTIFICATE","VERIFICATION","DOCUMENT_UPLOAD","ACCESS","DATA_CORRECTION","PERFORMANCE","OTHER"]),severity:z.enum(["LOW","NORMAL","HIGH","CRITICAL"]).default("NORMAL"),subject:z.string().trim().min(5).max(140),description:z.string().trim().min(15).max(4000)}).parse(q.body);
  let organizationId=null;
  if(q.user.role==="EMPLOYER"){
    const {data:org,error}=await q.supabase.from("Organization").select("id,status").eq("ownerId",q.user.id).maybeSingle();
    if(error)throw error;
    if(org)organizationId=org.id;
  }
  const id=crypto.randomUUID(),ticketNumber="VRT-"+crypto.randomBytes(4).toString("hex").toUpperCase(),now=new Date().toISOString();
  const {data,error}=await q.supabase.from("IssueReport").insert({id,ticketNumber,reporterId:q.user.id,organizationId,...b,status:"OPEN",createdAt:now,updatedAt:now}).select("id,ticketNumber,reporterId,organizationId,category,severity,subject,description,status,createdAt,updatedAt").single();
  if(error)throw error;
  await audit(q.supabase,q.user.id,"ISSUE_REPORT_CREATED","IssueReport",id,{ticketNumber,category:b.category,severity:b.severity,organizationId});
  await notifyVerityAdmins({type:"SUPPORT_CREATED",category:"SUPPORT",title:"New support conversation",body:b.subject+" · "+ticketNumber,url:"/issues",metadata:{issueId:id,ticketNumber}});
  s.status(201).json({issue:data,message:"Your report has been submitted. Keep the ticket reference for follow-up."});
}));
app.patch("/api/issues/:id",auth,run(async(q,s)=>{
  const b=z.object({status:z.enum(["IN_PROGRESS","WAITING_FOR_USER","RESOLVED","CLOSED"])}).parse(q.body);
  const isAdmin=q.user.role==="ADMIN";
  let org=null;
  if(!isAdmin){
    const {data,error}=await q.supabase.from("Organization").select("id,type,status").eq("ownerId",q.user.id).maybeSingle();
    if(error)throw error;org=data;
    if(!org||org.status!=="APPROVED")return s.status(403).json({error:"Only an approved organization or institution owner can manage reports associated with that organization."});
  }
  const patch={status:b.status,updatedAt:new Date().toISOString()};
  if(b.status==="RESOLVED"||b.status==="CLOSED")patch.resolvedAt=new Date().toISOString();
  if(b.status==="IN_PROGRESS"||b.status==="WAITING_FOR_USER")patch.resolvedAt=null;
  let query=q.supabase.from("IssueReport").update(patch).eq("id",q.params.id);
  if(!isAdmin)query=query.eq("organizationId",org.id);
  const {data,error}=await query.select("id,ticketNumber,status,updatedAt,resolvedAt").maybeSingle();
  if(error)throw error;if(!data)return s.status(404).json({error:"Issue report not found in your permitted workspace."});
  await audit(q.supabase,q.user.id,"ISSUE_REPORT_"+b.status,"IssueReport",data.id,{ticketNumber:data.ticketNumber,organizationId:org?.id||null});
  s.json({issue:data});
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
let stopStudentImportWorker=null;
let stopBulkCertificateWorker=null;
async function start(){
  if(!configured) throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required.");
  const chain=await connectChain();
  console.log("Supabase Auth and Data API configured.");
  console.log("Blockchain:",chain.enabled?"connected (optional Polygon anchor)":"disabled (optional future layer)");
  console.log("Certificate ledger: Supabase append-only SHA-256 hash chain.");
  console.log("Document security: private storage, file-signature validation and SHA-256 integrity checks; antivirus scanning is disabled.");
  if(STUDENT_IMPORT_WORKER_ENABLED){
    const workerClient=createClient(SUPABASE_URL,SUPABASE_SERVER_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    stopStudentImportWorker=startStudentImportWorker({client:workerClient});
    console.log("Student roster import worker: enabled (in-process, durable PostgreSQL queue).");
  }else{
    console.log("Student roster import worker: disabled; set ENABLE_STUDENT_IMPORT_WORKER=true and a server-only Supabase service key after the queue migration is deployed.");
  }
  if(BULK_CERTIFICATE_WORKER_ENABLED){
    const workerClient=makeServerClient();
    const processor=createBulkCertificateProcessor({
      client:workerClient,
      audit,
      createVerityNotification,
      notifyVerityAdmins
    });
    stopBulkCertificateWorker=startBulkCertificateWorker({
      client:workerClient,
      processItem:processor.processItem,
      reconcilePending:processor.reconcilePending
    });
    console.log("Bulk certificate issuance worker: enabled (in-process, durable PostgreSQL queue; Supabase ledger only).");
  }else{
    console.log("Bulk certificate issuance worker: disabled; set ENABLE_BULK_CERTIFICATE_WORKER=true and a server-only Supabase service key after the queue migration is deployed.");
  }
  const server=app.listen(PORT,"0.0.0.0",()=>console.log(`Verity listening on ${PORT}`));
  const shutdown=async signal=>{
    console.log(`Received ${signal}; stopping VERITY workers and HTTP server.`);
    try{await stopStudentImportWorker?.();}catch(error){console.error("Student import worker shutdown failed:",error);}
    try{await stopBulkCertificateWorker?.();}catch(error){console.error("Bulk certificate worker shutdown failed:",error);}
    server.close(()=>process.exit(0));
  };
  process.once("SIGTERM",()=>shutdown("SIGTERM"));
  process.once("SIGINT",()=>shutdown("SIGINT"));
}
start().catch(e=>{console.error(e);process.exit(1);});