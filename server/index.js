import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { connectChain, chainStatus, issueOnChain, revokeOnChain, verifyOnChain } from "./chain.js";

const prisma = new PrismaClient();
const app = express();
const PORT = Number(process.env.PORT || 8080);
const SECRET = process.env.JWT_SECRET || "";
const root = path.dirname(fileURLToPath(import.meta.url));
if (SECRET.length < 32) console.warn("Set JWT_SECRET to a random value of at least 32 characters.");
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") || true }));
app.use(express.json({ limit: "1mb" }));
app.use("/api/auth", rateLimit({ windowMs: 900000, limit: 20 }));
const run = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const digest = s => crypto.createHash("sha256").update(s).digest("hex");
const canonical = c => JSON.stringify({
  certificateId:c.certificateId, studentName:c.studentName.trim(), studentNumber:c.studentNumber.trim(),
  institution:c.institution.trim(), faculty:c.faculty.trim(), department:c.department.trim(),
  programme:c.programme.trim(), qualification:c.qualification.trim(), classification:c.classification||"",
  awardDate:new Date(c.awardDate).toISOString()
});
const safe = ({id,fullName,email,role,institution}) => ({id,fullName,email,role,institution});
const token = u => jwt.sign({sub:u.id,role:u.role},SECRET,{expiresIn:"8h",issuer:"verity"});
function auth(req,res,next) {
  const t=req.headers.authorization?.replace(/^Bearer\s+/i,"");
  if(!t || SECRET.length<32) return res.status(401).json({error:"Please sign in again."});
  try { req.user=jwt.verify(t,SECRET,{issuer:"verity"}); next(); }
  catch { res.status(401).json({error:"Session expired. Please sign in again."}); }
}
const roles=(...allowed)=>(req,res,next)=>allowed.includes(req.user.role)?next():res.status(403).json({error:"Permission denied."});
const audit=(actorId,action,entity,entityId,metadata={})=>prisma.auditEvent.create({data:{actorId,action,entity,entityId,metadata}});
app.get("/api/health",run(async(_q,s)=>{await prisma.$queryRaw`SELECT 1`;s.json({status:"ok",database:"connected",blockchain:chainStatus()});}));
app.post("/api/auth/register",run(async(q,s)=>{
 const b=z.object({fullName:z.string().min(2),email:z.string().email(),password:z.string().min(10),role:z.enum(["GRADUATE","EMPLOYER"]),institution:z.string().optional()}).parse(q.body);
 const u=await prisma.user.create({data:{fullName:b.fullName,email:b.email.toLowerCase(),passwordHash:await bcrypt.hash(b.password,12),role:b.role,institution:b.institution}});
 s.status(201).json({token:token(u),user:safe(u)});
}));
app.post("/api/auth/login",run(async(q,s)=>{
 const b=z.object({email:z.string().email(),password:z.string().min(1)}).parse(q.body);
 const u=await prisma.user.findUnique({where:{email:b.email.toLowerCase()}});
 if(!u||!(await bcrypt.compare(b.password,u.passwordHash)))return s.status(401).json({error:"Email or password is incorrect."});
 s.json({token:token(u),user:safe(u)});
}));
app.get("/api/auth/me",auth,run(async(q,s)=>{const u=await prisma.user.findUnique({where:{id:q.user.sub}});if(!u)return s.status(401).json({error:"Account not found."});s.json({user:safe(u)});}));
app.get("/api/dashboard",auth,run(async(q,s)=>{
 const where=q.user.role==="GRADUATE"?{graduateId:q.user.sub}:{};
 const visible=q.user.role!=="EMPLOYER";
 const [total,active,revoked,verifications,recent,recentChecks]=await Promise.all([
 visible?prisma.certificate.count({where}):0,visible?prisma.certificate.count({where:{...where,status:"ACTIVE"}}):0,
 visible?prisma.certificate.count({where:{...where,status:"REVOKED"}}):0,
 q.user.role==="ADMIN"?prisma.verification.count():0,
 visible?prisma.certificate.findMany({where,take:6,orderBy:{issuedAt:"desc"},select:{certificateId:true,studentName:true,qualification:true,institution:true,issuedAt:true,status:true}}):[],
 q.user.role==="ADMIN"?prisma.verification.findMany({take:6,orderBy:{createdAt:"desc"},include:{certificate:{select:{certificateId:true,studentName:true}}}}):[]
 ]);
 s.json({stats:{total,active,revoked,verifications},recent,recentChecks,blockchain:chainStatus()});
}));
app.get("/api/certificates",auth,roles("ADMIN","GRADUATE"),run(async(q,s)=>{
 const where=q.user.role==="GRADUATE"?{graduateId:q.user.sub}:{};
 s.json({certificates:await prisma.certificate.findMany({where,take:100,orderBy:{issuedAt:"desc"},select:{id:true,certificateId:true,studentName:true,studentNumber:true,institution:true,programme:true,qualification:true,classification:true,awardDate:true,issuedAt:true,digest:true,txHash:true,status:true,revokedAt:true,revokeReason:true}})});
}));
const issue=z.object({studentName:z.string().min(2),studentEmail:z.string().email().optional().or(z.literal("")),studentNumber:z.string().min(2),institution:z.string().min(2),faculty:z.string().min(2),department:z.string().min(2),programme:z.string().min(2),qualification:z.string().min(2),classification:z.string().optional(),awardDate:z.string().datetime()});
app.post("/api/certificates",auth,roles("ADMIN"),run(async(q,s)=>{
 const b=issue.parse(q.body), certificateId=`VRT-${new Date().getFullYear()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
 const clean=Object.fromEntries(Object.entries(b).map(([k,v])=>[k,typeof v==="string"?v.trim():v]));
 const hash=digest(canonical({...clean,certificateId}));
 const chain=await issueOnChain(certificateId,hash);
 const graduate=clean.studentEmail?await prisma.user.findUnique({where:{email:clean.studentEmail.toLowerCase()}}):null;
 const cert=await prisma.certificate.create({data:{...clean,studentEmail:clean.studentEmail||null,certificateId,digest:hash,awardDate:new Date(clean.awardDate),issuerId:q.user.sub,graduateId:graduate?.id||null,txHash:chain.txHash,chainId:chain.chainId,contractAddress:chain.contractAddress}});
 await audit(q.user.sub,"CERTIFICATE_ISSUED","Certificate",cert.id,{certificateId,mode:chain.mode});
 s.status(201).json({certificate:cert,chainMode:chain.mode});
}));
app.get("/api/certificates/:id/qr",auth,run(async(q,s)=>{
 const c=await prisma.certificate.findUnique({where:{certificateId:q.params.id}});
 if(!c)return s.status(404).json({error:"Certificate not found."});
 if(q.user.role==="GRADUATE"&&c.graduateId!==q.user.sub)return s.status(403).json({error:"Access denied."});
 if(q.user.role==="EMPLOYER")return s.status(403).json({error:"Use public verification."});
 const url=`${process.env.PUBLIC_APP_URL||q.protocol+"://"+q.get("host")}/verify/${encodeURIComponent(c.certificateId)}`;
 s.json({url,dataUrl:await QRCode.toDataURL(url,{width:420,margin:2})});
}));
app.post("/api/certificates/:id/revoke",auth,roles("ADMIN"),run(async(q,s)=>{
 const b=z.object({reason:z.string().min(5).max(500)}).parse(q.body);
 const c=await prisma.certificate.findUnique({where:{certificateId:q.params.id}});
 if(!c)return s.status(404).json({error:"Certificate not found."});
 if(c.status==="REVOKED")return s.status(409).json({error:"Already revoked."});
 const chain=await revokeOnChain(c.certificateId,b.reason);
 const updated=await prisma.certificate.update({where:{id:c.id},data:{status:"REVOKED",revokedAt:new Date(),revokeReason:b.reason}});
 await audit(q.user.sub,"CERTIFICATE_REVOKED","Certificate",c.id,{reason:b.reason,mode:chain.mode});
 s.json({certificate:updated,chainMode:chain.mode});
}));
app.post("/api/verify",run(async(q,s)=>{
 const b=z.object({certificateId:z.string().min(4),verifierName:z.string().optional(),verifierOrg:z.string().optional()}).parse(q.body);
 const c=await prisma.certificate.findUnique({where:{certificateId:b.certificateId.trim()}});
 if(!c)return s.status(404).json({verified:false,status:"NOT_FOUND",message:"No credential with this ID exists in the registry."});
 const recomputed=digest(canonical(c)), dbOk=recomputed===c.digest, chain=await verifyOnChain(c.certificateId);
 const chainOk=!chain.enabled||(chain.digest.toLowerCase()===recomputed.toLowerCase()&&!chain.revoked);
 const verified=c.status==="ACTIVE"&&dbOk&&chainOk;
 const status=c.status==="REVOKED"||chain.revoked?"REVOKED":verified?"VERIFIED":"INTEGRITY_MISMATCH";
 await prisma.verification.create({data:{certificateId:c.id,result:status,verifierName:b.verifierName,verifierOrg:b.verifierOrg}});
 s.json({verified,status,message:verified?"Credential matches the issuer's registered record.":status==="REVOKED"?"This credential has been revoked.":"The registered fingerprint does not match.",certificate:{certificateId:c.certificateId,studentName:c.studentName,institution:c.institution,faculty:c.faculty,department:c.department,programme:c.programme,qualification:c.qualification,classification:c.classification,awardDate:c.awardDate,issuedAt:c.issuedAt,digest:c.digest,txHash:c.txHash,status:c.status},chain:chain.enabled?{enabled:true,issuer:chain.issuer,issuedAt:chain.issuedAt}:{enabled:false,note:"Demo database ledger; configure an EVM RPC and signer for on-chain verification."}});
}));
app.get("/api/audit",auth,roles("ADMIN"),run(async(_q,s)=>s.json({events:await prisma.auditEvent.findMany({take:100,orderBy:{createdAt:"desc"},include:{actor:{select:{fullName:true,email:true}}}})})));
app.use("/api",(q,s)=>s.status(404).json({error:"API route not found."}));
app.use((e,q,s,_n)=>{if(e instanceof z.ZodError)return s.status(400).json({error:"Please check the form fields.",details:e.issues});if(e.code==="P2002")return s.status(409).json({error:"A record with these details already exists."});console.error(e);s.status(500).json({error:"Unexpected server error."});});
app.use(express.static(path.resolve(root,"../dist")));
app.get("*",(_q,s)=>s.sendFile(path.resolve(root,"../dist/index.html")));
async function start(){if(SECRET.length<32)throw new Error("JWT_SECRET must be at least 32 characters.");await prisma.$connect();const c=await connectChain();console.log("Blockchain:",c.enabled?"connected":"demo database ledger");app.listen(PORT,"0.0.0.0",()=>console.log(`Verity listening on ${PORT}`));}
start().catch(e=>{console.error(e);process.exit(1);});
