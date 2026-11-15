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
const canonical = c => JSON.stringify({
  certificateId:c.certificateId, studentName:c.studentName.trim(), studentNumber:c.studentNumber.trim(),
  institution:c.institution.trim(), faculty:c.faculty.trim(), department:c.department.trim(),
  programme:c.programme.trim(), qualification:c.qualification.trim(), classification:c.classification||"",
  awardDate:new Date(c.awardDate).toISOString()
});
const safe = u => ({id:u.id,fullName:u.fullName,email:u.email,role:u.role,institution:u.institution});
async function ensureOrganization(client, authUser, profile) {
 if(profile.role!=="EMPLOYER") return null;
 const {data:found,error}=await client.from("Organization").select("*").eq("ownerId",profile.id).maybeSingle(); if(error)throw error;if(found)return found;
 const m=authUser.user_metadata||{}, name=String(m.organizationName||m.institution||profile.institution||"").trim(); if(name.length<2)return null;
 const org={id:crypto.randomUUID(),name,type:m.organizationType==="EMPLOYER"?"EMPLOYER":"INSTITUTION",ownerId:profile.id,status:"PENDING",registrationCode:"VRT-"+crypto.randomBytes(4).toString("hex").toUpperCase()};
 const {data,error:e}=await client.from("Organization").insert(org).select().single();if(e)throw e;return data;
}
async function ensureStudentMembership(client, authUser, profile) {
 if(profile.role!=="GRADUATE")return; const code=String(authUser.user_metadata?.organizationCode||"").trim().toUpperCase();if(!code)return;
 const {data:org,error}=await client.from("Organization").select("id,status").eq("registrationCode",code).maybeSingle();if(error)throw error;if(!org||org.status!=="APPROVED")return;
 const {data:exists,error:e}=await client.from("Membership").select("id").eq("organizationId",org.id).eq("userId",profile.id).maybeSingle();if(e)throw e;
 if(!exists){const {error:ie}=await client.from("Membership").insert({id:crypto.randomUUID(),organizationId:org.id,userId:profile.id,studentNumber:authUser.user_metadata?.studentNumber||null,status:"PENDING"});if(ie)throw ie;}
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
async function audit(client,actorId,action,entity,entityId,metadata={}) {
  const {error}=await client.from("AuditEvent").insert({id:crypto.randomUUID(),actorId,action,entity,entityId,metadata,createdAt:new Date().toISOString()});
  if(error) throw error;
}

app.get("/api/health",(_q,s)=>s.json({status:"ok",database:configured?"supabase_data_api_configured":"not_configured",blockchain:chainStatus()}));

app.post("/api/auth/register",run(async(q,s)=>{
  const b=z.object({fullName:z.string().min(2),email:z.string().email(),password:z.string().min(10),role:z.enum(["GRADUATE","EMPLOYER"]),institution:z.string().optional(),organizationName:z.string().optional(),organizationType:z.enum(["INSTITUTION","EMPLOYER"]).optional(),organizationCode:z.string().optional(),studentNumber:z.string().optional()}).parse(q.body); if(b.role==="EMPLOYER"&&String(b.organizationName||b.institution||"").trim().length<2)return s.status(400).json({error:"Enter your organization name."});
  const client=makeClient();
  const {data,error}=await client.auth.signUp({
    email:b.email.trim().toLowerCase(),password:b.password,
    options:{data:{fullName:b.fullName.trim(),institution:b.institution?.trim()||"",role:b.role,organizationName:b.organizationName?.trim()||"",organizationType:b.organizationType||"INSTITUTION",organizationCode:b.organizationCode?.trim().toUpperCase()||"",studentNumber:b.studentNumber?.trim()||""}}
  });
  if(error) return s.status(400).json({error:error.message});
  if(!data.session) return s.status(201).json({pendingEmailConfirmation:true,message:"Check your email and confirm your account before signing in."});
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
app.get("/api/auth/me",auth,run(async(q,s)=>{const organization=await ensureOrganization(q.supabase,q.authUser,q.user);await ensureStudentMembership(q.supabase,q.authUser,q.user);s.json({user:safe(q.user),organization});}));
app.get("/api/organization",auth,roles("EMPLOYER"),run(async(q,s)=>{const {data,error}=await q.supabase.from("Organization").select("*").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;s.json({organization:data});}));
app.get("/api/organization/members",auth,roles("EMPLOYER"),run(async(q,s)=>{const {data:org,error}=await q.supabase.from("Organization").select("id").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;if(!org)return s.json({members:[]});const {data,error:e}=await q.supabase.from("Membership").select("id,userId,studentNumber,status,createdAt").eq("organizationId",org.id).order("createdAt",{ascending:false});if(e)throw e;const ids=(data||[]).map(x=>x.userId);const {data:people,error:pe}=ids.length?await q.supabase.from("User").select("id,fullName,email,institution").in("id",ids):{data:[],error:null};if(pe)throw pe;s.json({members:(data||[]).map(m=>({...m,user:(people||[]).find(p=>p.id===m.userId)||null}))});}));
app.patch("/api/organization/members/:id",auth,roles("EMPLOYER"),run(async(q,s)=>{const b=z.object({status:z.enum(["ACTIVE","REJECTED"])}).parse(q.body);const {data:org,error}=await q.supabase.from("Organization").select("id,status").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;if(!org||org.status!=="APPROVED")return s.status(403).json({error:"Your organization must be approved first."});const {data,error:e}=await q.supabase.from("Membership").update({status:b.status,updatedAt:new Date().toISOString()}).eq("id",q.params.id).eq("organizationId",org.id).select().single();if(e)throw e;await audit(q.supabase,q.user.id,"STUDENT_MEMBERSHIP_"+b.status,"Membership",data.id,{organizationId:org.id});s.json({membership:data});}));
app.get("/api/admin/organizations",auth,roles("ADMIN"),run(async(q,s)=>{const {data,error}=await q.supabase.from("Organization").select("*").order("createdAt",{ascending:false});if(error)throw error;s.json({organizations:data||[]});}));
app.patch("/api/admin/organizations/:id",auth,roles("ADMIN"),run(async(q,s)=>{const b=z.object({status:z.enum(["APPROVED","SUSPENDED"])}).parse(q.body);const {data,error}=await q.supabase.from("Organization").update({status:b.status,updatedAt:new Date().toISOString()}).eq("id",q.params.id).select().single();if(error)throw error;await audit(q.supabase,q.user.id,"ORGANIZATION_"+b.status,"Organization",data.id,{organizationId:data.id});s.json({organization:data});}));

app.get("/api/dashboard",auth,run(async(q,s)=>{
  const admin=q.user.role==="ADMIN", graduate=q.user.role==="GRADUATE"; const {data:ownedOrg}=q.user.role==="EMPLOYER"?await q.supabase.from("Organization").select("id,status,name").eq("ownerId",q.user.id).maybeSingle():{data:null};
  const base=()=>q.supabase.from("Certificate").select("id",{count:"exact",head:true});
  const scoped=()=>graduate?base().eq("graduateId",q.user.id):q.user.role==="EMPLOYER"?base().eq("organizationId",ownedOrg?.id||""):base();
  const [total,active,revoked,verifications,recent,recentChecks]=await Promise.all([
    scoped(),
    (graduate?base().eq("graduateId",q.user.id):q.user.role==="EMPLOYER"?base().eq("organizationId",ownedOrg?.id||""):base()).eq("status","ACTIVE"),
    (graduate?base().eq("graduateId",q.user.id):q.user.role==="EMPLOYER"?base().eq("organizationId",ownedOrg?.id||""):base()).eq("status","REVOKED"),
    admin?q.supabase.from("Verification").select("id",{count:"exact",head:true}):q.user.role==="EMPLOYER"?q.supabase.from("Verification").select("id",{count:"exact",head:true}).eq("organizationId",ownedOrg?.id||""):Promise.resolve({count:0}),
    q.supabase.from("Certificate").select("certificateId,studentName,qualification,institution,issuedAt,status").order("issuedAt",{ascending:false}).limit(6),
    admin?q.supabase.from("Verification").select("id,result,createdAt,certificateId").order("createdAt",{ascending:false}).limit(6):Promise.resolve({data:[]})
  ]);
  for(const x of [total,active,revoked,verifications,recent,recentChecks]) if(x.error) throw x.error;
  s.json({stats:{total:total.count||0,active:active.count||0,revoked:revoked.count||0,verifications:verifications.count||0},recent:recent.data||[],recentChecks:recentChecks.data||[],organization:ownedOrg,blockchain:chainStatus()});
}));

app.get("/api/certificates",auth,roles("ADMIN","GRADUATE","EMPLOYER"),run(async(q,s)=>{
  let query=q.supabase.from("Certificate").select("id,certificateId,studentName,studentNumber,institution,programme,qualification,classification,awardDate,issuedAt,digest,txHash,status,revokedAt,revokeReason").order("issuedAt",{ascending:false}).limit(100);
  if(q.user.role==="GRADUATE") query=query.eq("graduateId",q.user.id); if(q.user.role==="EMPLOYER"){const {data:org,error:oe}=await q.supabase.from("Organization").select("id").eq("ownerId",q.user.id).maybeSingle();if(oe)throw oe;query=query.eq("organizationId",org?.id||"");}
  const {data,error}=await query;
  if(error) throw error;
  s.json({certificates:data||[]});
}));

const issue=z.object({studentName:z.string().min(2),studentEmail:z.string().email().optional().or(z.literal("")),studentNumber:z.string().min(2),institution:z.string().min(2),faculty:z.string().min(2),department:z.string().min(2),programme:z.string().min(2),qualification:z.string().min(2),classification:z.string().optional(),awardDate:z.string().datetime()});
app.post("/api/certificates",auth,roles("ADMIN","EMPLOYER"),run(async(q,s)=>{
  const b=issue.parse(q.body); let organization=null;if(q.user.role==="EMPLOYER"){const {data,error}=await q.supabase.from("Organization").select("*").eq("ownerId",q.user.id).maybeSingle();if(error)throw error;organization=data;if(!organization||organization.status!=="APPROVED")return s.status(403).json({error:"Your organization must be approved by the Verity System Admin before issuing certificates."});}
  const certificateId=`VRT-${new Date().getFullYear()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const clean=Object.fromEntries(Object.entries(b).map(([k,v])=>[k,typeof v==="string"?v.trim():v]));
  const hash=digest(canonical({...clean,certificateId}));
  const chain=await issueOnChain(certificateId,hash);
  let graduateId=null;
  if(clean.studentEmail){
    const {data:graduate,error:gError}=await q.supabase.from("User").select("id").eq("email",clean.studentEmail.toLowerCase()).maybeSingle();
    if(gError) throw gError;
    graduateId=graduate?.id||null;
  }
  const now=new Date().toISOString();
  const record={...clean,id:crypto.randomUUID(),studentEmail:clean.studentEmail||null,certificateId,organizationId:organization?.id||null,digest:hash,awardDate:new Date(clean.awardDate).toISOString(),issuerId:q.user.id,graduateId,txHash:chain.txHash,chainId:chain.chainId,contractAddress:chain.contractAddress,createdAt:now,updatedAt:now,issuedAt:now};
  const {data,error}=await q.supabase.from("Certificate").insert(record).select().single();
  if(error) throw error;
  await audit(q.supabase,q.user.id,"CERTIFICATE_ISSUED","Certificate",data.id,{certificateId,mode:chain.mode,organizationId:organization?.id||null});
  s.status(201).json({certificate:data,chainMode:chain.mode});
}));

app.get("/api/certificates/:id/qr",auth,run(async(q,s)=>{
  const {data:c,error}=await q.supabase.from("Certificate").select("id,certificateId,graduateId").eq("certificateId",q.params.id).maybeSingle();
  if(error) throw error;
  if(!c) return s.status(404).json({error:"Certificate not found."}); if(q.user.role==="EMPLOYER"){const {data:org}=await q.supabase.from("Organization").select("id,status").eq("ownerId",q.user.id).maybeSingle();if(!org||org.id!==c.organizationId||org.status!=="APPROVED")return s.status(403).json({error:"You can only revoke certificates issued by your approved organization."});}
  if(q.user.role==="GRADUATE"&&c.graduateId!==q.user.id) return s.status(403).json({error:"Access denied."});
  if(q.user.role==="EMPLOYER") return s.status(403).json({error:"Use public verification."});
  const url=`${process.env.PUBLIC_APP_URL||q.protocol+"://"+q.get("host")}/verify/${encodeURIComponent(c.certificateId)}`;
  s.json({url,dataUrl:await QRCode.toDataURL(url,{width:420,margin:2})});
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

app.post("/api/verify",run(async(q,s)=>{
  const b=z.object({certificateId:z.string().min(4),verifierName:z.string().optional(),verifierOrg:z.string().optional()}).parse(q.body);
  const client=makeClient();
  const {data,error}=await client.rpc("lookup_verity_certificate",{p_certificate_id:b.certificateId.trim(),p_verifier_name:b.verifierName||null,p_verifier_org:b.verifierOrg||null});
  if(error) throw error;
  if(!data?.found) return s.status(404).json({verified:false,status:"NOT_FOUND",message:"No credential with this ID exists in the registry."});
  const c=data;
  const recomputed=digest(canonical(c)), dbOk=recomputed===c.digest, chain=await verifyOnChain(c.certificateId);
  const chainOk=!chain.enabled||(chain.exists===true&&chain.digest?.toLowerCase()===recomputed.toLowerCase()&&!chain.revoked);
  const verified=c.status==="ACTIVE"&&dbOk&&chainOk;
  const status=c.status==="REVOKED"||chain.revoked?"REVOKED":verified?"VERIFIED":"INTEGRITY_MISMATCH";
  s.json({verified,status,message:verified?"Credential matches the issuer's registered record.":status==="REVOKED"?"This credential has been revoked.":"The registered fingerprint does not match.",certificate:{certificateId:c.certificateId,studentName:c.studentName,institution:c.institution,faculty:c.faculty,department:c.department,programme:c.programme,qualification:c.qualification,classification:c.classification,awardDate:c.awardDate,issuedAt:c.issuedAt,digest:c.digest,txHash:c.txHash,status:c.status},chain:chain.enabled?{enabled:true,exists:chain.exists,network:"Polygon Amoy",chainId:chain.chainId,contractAddress:chain.contractAddress,issuer:chain.issuer,issuedAt:chain.issuedAt}:{enabled:false,note:"Demo database ledger; configure Polygon Amoy RPC, project signer and deployed contract for on-chain verification."}});
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