import React, { useEffect, useState } from "react";
import { ShieldCheck, Play, Pause, RotateCcw, SkipForward, CheckCircle2, Building2, GraduationCap, Users, Activity, LockKeyhole, ArrowUpRight, FileCheck2, Fingerprint, Share2 } from "lucide-react";

const scenes = [
  { kicker:"VERITY · USER GUIDE", title:"Trust every credential.", copy:"A connected platform for issuing, sharing and verifying academic achievements.", label:"THE FUTURE OF DIGITAL CREDENTIAL VERIFICATION" },
  { kicker:"01 / LIVE PLATFORM OVERVIEW", title:"One network. Four workspaces.", copy:"A live operational view of institution, graduate, organization and administrator workflows.", label:"LIVE DASHBOARD · REAL PLATFORM TOTALS" },
  { kicker:"02 / INSTITUTION", title:"Start with the official student record.", copy:"An approved institution reviews its student directory before issuing academic credentials.", label:"STUDENT IDENTITY · INSTITUTIONAL CONTROL" },
  { kicker:"03 / UNIQUE CREDENTIAL", title:"Every issuance gets its own identity.", copy:"VERITY creates a certificate ID, verification key and SHA-256 fingerprint for each issued credential.", label:"CERTIFICATE ID · VERIFICATION KEY · FINGERPRINT" },
  { kicker:"04 / GRADUATE", title:"Your achievements. In your hands.", copy:"Graduates activate their account against the institution's official roster and access their credentials.", label:"APPROVED INSTITUTION · STUDENT IDENTITY" },
  { kicker:"05 / SECURE SHARING", title:"Share proof. Protect the original.", copy:"Share a verification link or key. Private original documents remain protected by graduate consent.", label:"VERIFICATION LINK · CONSENT-BASED ACCESS" },
  { kicker:"06 / ORGANIZATION", title:"Verify before you decide.", copy:"Organizations check issuer identity, credential status and integrity through VERITY.", label:"APPROVED ISSUER · REGISTRY RESPONSE" },
  { kicker:"07 / ADMINISTRATION", title:"Oversight built into every workflow.", copy:"Administrators oversee organization approvals, system health and audit activity.", label:"SUPABASE LEDGER · AUDIT · SYSTEM HEALTH" },
  { kicker:"08 / ROSTER IMPORT", title:"Upload is not approval.", copy:"CSV and native XLSX files open in the in-app editor. Changes autosave privately, so the uploader can leave and resume before submitting for approval.", label:"EDIT · AUTOSAVE · RESUME · VALIDATE" },
  { kicker:"09 / OWNER APPROVAL", title:"Only the issuer owner approves.", copy:"The Institution or Organization Owner reviews the import manifest and approves it. ICT cannot approve its own upload.", label:"MANDATORY OWNER APPROVAL" },
  { kicker:"10 / STUDENT DIRECTORY", title:"Corrections require a reason.", copy:"ICT submits proposed directory changes. The current student record remains unchanged while pending.", label:"REQUEST · EVIDENCE · REVIEW" },
  { kicker:"11 / OWNER DECISION", title:"The issuer owner decides.", copy:"The Institution or Organization Owner compares original and proposed values, then approves or rejects. Every decision is audited.", label:"OWNER-ONLY APPROVAL · AUDIT HISTORY" },
  { kicker:"12 / IMMUTABLE CERTIFICATE", title:"Issued means locked forever.", copy:"No role can edit the original certificate, its academic details, ID, verification key or fingerprint.", label:"NO EDIT · NO OVERWRITE · NO DELETE" },
  { kicker:"13 / CREDENTIAL CORRECTION", title:"A correction is a new issuance.", copy:"A separate request is reviewed. Approval authorizes a new issuance; it never edits the original certificate.", label:"PRESERVE ORIGINAL · ISSUE REPLACEMENT" },
  { kicker:"VERITY · COMPLETE", title:"Preserve the original. Verify the replacement.", copy:"Revoke the original with a reason, issue a new credential and verify both records through their audit history.", label:"ORIGINAL PRESERVED · NEW CERTIFICATE ID · AUDITABLE HISTORY" }
];
if (scenes.length !== 15) throw new Error("VERITY User Guide must contain exactly 15 navigable clips.");

function MiniMetric({label,value}) { return <div className="film-metric"><small>{label}</small><b>{value}</b></div>; }
function masked(value) {
  const text=String(value||"");
  if(!text) return "Available after issuance";
  if(text.length<12) return text.slice(0,4)+"••••";
  return text.slice(0,8)+"••••••••"+text.slice(-4);
}

export default function VerityShowcase({data, certificates=[], auditEvents=null, organization, onVerify, canDownload=false}) {
  const [scene,setScene] = useState(0);
  const [playing,setPlaying] = useState(false);
  const [elapsed,setElapsed] = useState(0);
  const [verifyResult,setVerifyResult] = useState(null);
  const [downloading,setDownloading] = useState(false);
  const [reference,setReference] = useState(certificates?.[0]?.verificationKey || certificates?.[0]?.certificateId || "");
  const duration = 120000;
  const current = scenes[scene];
  const progress = Math.min(100, elapsed / duration * 100);
  const sample = certificates?.[0];
  const latestAudit = auditEvents?.[0];
  const orgName = organization?.name || sample?.institution || "Approved academic institution";
  const stats = data?.stats || {};
  const chainActive = !!data?.blockchain?.enabled;
  const formatStatus = verifyResult ? (verifyResult.verified ? "VERIFIED" : verifyResult.status || "NOT VERIFIED") : null;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setElapsed(value => Math.min(duration, value + 100)), 100);
    return () => window.clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    const nextScene = Math.min(scenes.length - 1, Math.floor(elapsed / (duration / scenes.length)));
    setScene(nextScene);
    if (elapsed >= duration) setPlaying(false);
  }, [elapsed]);

  function replay() { setElapsed(0); setScene(0); setVerifyResult(null); setPlaying(true); }
  function skip() {
    const next = Math.min(scenes.length - 1, scene + 1);
    setScene(next);
    setElapsed(next * (duration / scenes.length));
    if (next === scenes.length - 1) setPlaying(false);
  }
  async function verifyActual() {
    if (!reference.trim() || !onVerify) return;
    try { setVerifyResult(await onVerify(reference.trim())); }
    catch (error) { setVerifyResult({verified:false,status:"CHECK FAILED",message:error.message}); }
  }

  return <section className="verity-film-page">
    <div className="film-topline"><div className="film-brand"><ShieldCheck/><b>VERITY</b><span>.</span></div><span>15-CLIP USER GUIDE · 02:00</span>{canDownload&&<button className="film-download" disabled={downloading} onClick={async()=>{setDownloading(true);try{const token=localStorage.getItem("verity_token");const response=await fetch("/api/admin/showcase-video",{headers:token?{Authorization:"Bearer "+token}:{}});if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||"Unable to generate the MP4.");}const blob=await response.blob();const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="VERITY-Marketing-Showcase.mp4";document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);}catch(error){window.alert(error.message);}finally{setDownloading(false);}}}>{downloading?"Preparing MP4…":"Download MP4"}</button>}</div>
    <div className="film-stage" key={scene}>
      <div className="film-light film-light-one"/><div className="film-light film-light-two"/>
      <div className="film-stage-copy"><small>{current.kicker}</small><h1>{current.title}</h1><p>{current.copy}</p><span className="film-scene-label">{current.label}</span></div>
      <div className="film-ui-window">
        <div className="film-window-bar"><span/><span/><span/><b>VERITY / {current.kicker}</b></div>
        {scene===0||scene===14 ? <div className="film-logo-scene"><ShieldCheck/><strong>VERITY<span>.</span></strong><small>ACADEMIC CREDENTIAL NETWORK</small></div> :
        scene===1 ? <div className="film-dashboard"><div className="film-dash-head"><div><small>PLATFORM OVERVIEW</small><b>Credential network</b></div><span className={chainActive?"film-live":"film-demo"}>{chainActive?"BLOCKCHAIN CONNECTED":"DATABASE LEDGER"}</span></div><div className="film-metrics"><MiniMetric label="Total credentials" value={stats.total??"—"}/><MiniMetric label="Active" value={stats.active??"—"}/><MiniMetric label="Revoked" value={stats.revoked??"—"}/><MiniMetric label="Verifications" value={stats.verifications??"—"}/></div><div className="film-record"><FileCheck2/><div><b>Recent credential activity</b><small>{sample?.qualification||"Academic qualification"} · {sample?.institution||orgName}</small></div><span>{sample?.status||"LIVE REGISTRY"}</span></div></div> :
        scene===2 ? <div className="film-module"><div className="film-module-icon"><Building2/></div><div><small>INSTITUTION WORKSPACE</small><b>{orgName}</b><p>Student details → Award review → Certificate issuance</p></div><div className="film-steps"><span><CheckCircle2/> Student record reviewed</span><span><CheckCircle2/> Academic award confirmed</span><span><Fingerprint/> Credential fingerprint created</span></div><div className="film-issued"><b>{sample?.qualification||"Academic award"}</b><small>{sample?.awardDate?new Date(sample.awardDate).toLocaleDateString():"Award date recorded on issuance"}</small></div></div> :
        scene===3 ? <div className="film-module"><div className="film-module-icon"><Fingerprint/></div><div><small>ISSUANCE CONFIRMATION</small><b>Unique credential references</b><p>Generated by Verity when the institution registers the certificate</p></div><div className="film-code"><small>Certificate ID</small><b>{masked(sample?.certificateId)}</b><small>Verification key</small><b>{masked(sample?.verificationKey)}</b></div><div className="film-issued"><small>Reference privacy</small><b>Live credential values are partially masked in this showcase</b></div></div> :
        scene===4 ? <div className="film-module graduate"><div className="film-module-icon"><GraduationCap/></div><div><small>GRADUATE WORKSPACE</small><b>My credentials</b><p>Personal academic records and verification details</p></div><div className="film-credential"><span><FileCheck2/></span><div><b>{sample?.qualification||"Academic credential"}</b><small>{sample?.institution||"Issuing institution"} · {sample?.status||"Credential status"}</small></div><ArrowUpRight/></div><div className="film-consent"><LockKeyhole/><span>Original document sharing</span><b>Graduate consent required</b></div></div> :
        scene===5 ? <div className="film-module"><div className="film-module-icon"><Share2/></div><div><small>GRADUATE SHARING</small><b>Share verification details</b><p>Send the QR, verification link or unique key to the intended verifier</p></div><div className="film-verify-row"><span>Verification key</span><b>{masked(sample?.verificationKey)}</b></div><div className="film-verify-state"><LockKeyhole/><div><b>Private original certificate</b><small>Separate access request · Graduate approval required</small></div></div></div> :
        scene===6 ? <div className="film-proof"><div className="film-proof-icon"><Building2/></div><small>ORGANIZATION CREDENTIAL CHECK</small><b>{formatStatus || "Verify a credential"}</b><p>{verifyResult?.message || "Submit the actual credential ID or verification key to check the live registry."}</p><span>{chainActive?"ON-CHAIN STATUS AVAILABLE":"DATABASE LEDGER · NO LIVE CHAIN CLAIM"}</span><label className="film-reference-field"><span>Credential ID or verification key</span><input value={reference} onChange={e=>{setReference(e.target.value);setVerifyResult(null);}} placeholder="Enter an actual Verity reference"/></label><button onClick={verifyActual} disabled={!onVerify||!reference.trim()}>Run actual credential check</button></div> : scene>=8&&scene<=13 ? <div className="film-module"><div className="film-module-icon"><ShieldCheck/></div><div><small>{current.kicker}</small><b>{current.title}</b><p>{current.copy}</p></div><div className="film-steps"><span><CheckCircle2/> {current.label}</span><span><LockKeyhole/> Original certificate remains immutable</span><span><Activity/> Decision and history are auditable</span></div><div className="film-issued"><b>VERITY PROTECTION</b><small>Owner authorization · immutable credential record</small></div></div> : <div className="film-admin"><div><Users/><span>Organizations</span><b>Identity review & approval</b></div><div><Activity/><span>Audit activity</span><b>{latestAudit?latestAudit.action?.replaceAll("_"," ")+" · "+(latestAudit.actor?.fullName||"System"):auditEvents?"No recent audit events":"Administrator-only audit history"}</b></div><div><CheckCircle2/><span>System health</span><b>{chainActive?"EVM network connected":"Database ledger mode"}</b></div></div>}
      </div>
      <div className="film-corner">VERITY <b>{String(scene+1).padStart(2,"0")}</b> / 15</div>
    </div>
    <div className="film-controls">
      <div className="film-progress"><div style={{width:progress+"%"}}/><i style={{left:progress+"%"}}/></div>
      <div className="film-control-row"><div className="film-buttons"><button onClick={()=>playing?setPlaying(false):elapsed>=duration?replay():setPlaying(true)}>{playing?<Pause/>:<Play/>}{playing?"Pause":elapsed>=duration?"Replay":"Play film"}</button><button className="film-icon-button" onClick={replay} aria-label="Replay"><RotateCcw/></button><button className="film-icon-button" onClick={skip} aria-label="Skip scene"><SkipForward/></button></div><div className="film-timing"><b>{String(Math.floor(elapsed/60000)).padStart(2,"0")}:{String(Math.floor((elapsed%60000)/1000)).padStart(2,"0")}</b><span> / 02:00</span></div></div>
      <div className="film-scene-dots">{scenes.map((item,i)=><button key={item.kicker} className={scene===i?"active":""} onClick={()=>{setScene(i);setElapsed(i*(duration/scenes.length));setPlaying(false);}} aria-label={"Go to scene "+(i+1)} title={item.label}/>)}</div>
    </div>
    <p className="film-footnote">The 15-clip in-app User Guide uses live dashboard totals and available credential records. The Admin MP4 export performs a live registry lookup before rendering; student identifiers are masked. Supabase is the source of truth and blockchain is shown only when a configured network confirms it.</p>
  </section>;
}
