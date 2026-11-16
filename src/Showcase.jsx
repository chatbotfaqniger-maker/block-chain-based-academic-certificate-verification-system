import React, { useEffect, useState } from "react";
import { ShieldCheck, Play, Pause, RotateCcw, SkipForward, CheckCircle2, Building2, GraduationCap, Users, Activity, LockKeyhole, ArrowUpRight, FileCheck2, Fingerprint } from "lucide-react";

const scenes = [
  { kicker:"VERITY · DIGITAL CREDENTIAL NETWORK", title:"Trust every credential.", copy:"A clearer, safer way to issue, share and verify academic achievements.", label:"THE FUTURE OF DIGITAL CREDENTIAL VERIFICATION" },
  { kicker:"01 / PLATFORM OVERVIEW", title:"One connected credential workspace.", copy:"A live operational view for institutions, graduates, organizations and platform administrators.", label:"DASHBOARD" },
  { kicker:"02 / INSTITUTION", title:"Issue with institutional confidence.", copy:"Register students, review academic details and issue credentials through an approved institution account.", label:"STUDENT REGISTRATION · CERTIFICATE ISSUANCE" },
  { kicker:"03 / GRADUATE", title:"Your achievements. In your hands.", copy:"Access personal credentials, share a verification reference and control requests for original documents.", label:"PERSONAL CREDENTIALS · CONSENT-BASED SHARING" },
  { kicker:"04 / ORGANIZATION", title:"Verify before you decide.", copy:"Check a certificate reference against the issuer’s registry and review the returned credential status.", label:"ORGANIZATION VERIFICATION" },
  { kicker:"05 / ADMINISTRATION", title:"Oversight built into every workflow.", copy:"Review organization approvals, audit activity and reported system health from one control centre.", label:"PLATFORM MANAGEMENT · AUDIT · SYSTEM HEALTH" },
  { kicker:"06 / INTEGRITY CHECK", title:"A credential. A verifiable record.", copy:"Verity checks the registered details and fingerprint, and reports blockchain status only when an EVM network is connected.", label:"ACTUAL CREDENTIAL VERIFICATION" },
  { kicker:"VERITY", title:"Achievement deserves proof.", copy:"Issue responsibly. Share securely. Verify with confidence.", label:"THE FUTURE OF DIGITAL CREDENTIAL VERIFICATION" }
];

function MiniMetric({label,value}) { return <div className="film-metric"><small>{label}</small><b>{value}</b></div>; }

export default function VerityShowcase({data, certificates=[], organization, onVerify}) {
  const [scene,setScene] = useState(0);
  const [playing,setPlaying] = useState(false);
  const [elapsed,setElapsed] = useState(0);
  const [verifyResult,setVerifyResult] = useState(null);
  const [reference,setReference] = useState(certificates?.[0]?.certificateId || "");
  const duration = 58000;
  const current = scenes[scene];
  const progress = Math.min(100, elapsed / duration * 100);
  const sample = certificates?.[0];
  const orgName = organization?.name || "Your institution";
  const stats = data?.stats || {};
  const chainActive = !!data?.blockchain?.enabled;
  const formatStatus = verifyResult ? (verifyResult.verified ? "VERIFIED" : verifyResult.status || "NOT VERIFIED") : null;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setElapsed(value => Math.min(duration, value + 100));
    }, 100);
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
    try { const result = await onVerify(reference.trim()); setVerifyResult(result); }
    catch (error) { setVerifyResult({verified:false,status:"CHECK FAILED",message:error.message}); }
  }

  return <section className="verity-film-page">
    <div className="film-topline"><div className="film-brand"><ShieldCheck/><b>VERITY</b><span>.</span></div><span>PRODUCT FILM · 00:58</span></div>
    <div className="film-stage" key={scene}>
      <div className="film-light film-light-one"/><div className="film-light film-light-two"/>
      <div className="film-stage-copy"><small>{current.kicker}</small><h1>{current.title}</h1><p>{current.copy}</p><span className="film-scene-label">{current.label}</span></div>
      <div className="film-ui-window">
        <div className="film-window-bar"><span/><span/><span/><b>VERITY / {["NETWORK","OVERVIEW","INSTITUTION","GRADUATE","VERIFICATION","CONTROL CENTRE","INTEGRITY CHECK","VERITY"][scene]}</b></div>
        {scene===0||scene===7 ? <div className="film-logo-scene"><ShieldCheck/><strong>VERITY<span>.</span></strong><small>ACADEMIC CREDENTIAL NETWORK</small></div> :
        scene===1 ? <div className="film-dashboard"><div className="film-dash-head"><div><small>PLATFORM OVERVIEW</small><b>Credential network</b></div><span className={chainActive?"film-live":"film-demo"}>{chainActive?"BLOCKCHAIN CONNECTED":"DATABASE LEDGER"}</span></div><div className="film-metrics"><MiniMetric label="Total credentials" value={stats.total??"—"}/><MiniMetric label="Active" value={stats.active??"—"}/><MiniMetric label="Revoked" value={stats.revoked??"—"}/><MiniMetric label="Verifications" value={stats.verifications??"—"}/></div><div className="film-record"><FileCheck2/><div><b>Recent credential activity</b><small>{sample?.qualification||"Academic qualification"} · {sample?.institution||orgName}</small></div><span>{sample?.status||"REGISTERED"}</span></div></div> :
        scene===2 ? <div className="film-module"><div className="film-module-icon"><Building2/></div><div><small>INSTITUTION WORKSPACE</small><b>{orgName}</b><p>Student record → Academic review → Certificate issuance</p></div><div className="film-steps"><span><CheckCircle2/> Graduate account linked</span><span><CheckCircle2/> Award details reviewed</span><span><Fingerprint/> Credential fingerprint created</span></div><div className="film-issued"><b>VRT-{new Date().getFullYear()}-••••••••</b><small>Unique credential reference · QR verification</small></div></div> :
        scene===3 ? <div className="film-module graduate"><div className="film-module-icon"><GraduationCap/></div><div><small>GRADUATE WORKSPACE</small><b>My credentials</b><p>Personal academic records and sharing controls</p></div><div className="film-credential"><span><FileCheck2/></span><div><b>{sample?.qualification||"Academic credential"}</b><small>{sample?.institution||"Issuing institution"} · {sample?.status||"ACTIVE"}</small></div><ArrowUpRight/></div><div className="film-consent"><LockKeyhole/><span>Original document sharing</span><b>Graduate consent required</b></div></div> :
        scene===4 ? <div className="film-module"><div className="film-module-icon"><Building2/></div><div><small>ORGANIZATION WORKSPACE</small><b>Verify a credential</b><p>Reference lookup · Issuer match · Status review</p></div><div className="film-verify-row"><span>Certificate reference</span><b>{sample?.certificateId||"Enter certificate ID or key"}</b></div><div className="film-verify-state"><CheckCircle2/><div><b>Registry response</b><small>Credential status and issuer details returned</small></div></div></div> :
        scene===5 ? <div className="film-admin"><div><Users/><span>Organizations</span><b>Identity review & approval</b></div><div><Activity/><span>Audit activity</span><b>Action history & accountability</b></div><div><CheckCircle2/><span>System health</span><b>{chainActive?"EVM network connected":"Database ledger mode"}</b></div></div> :
        <div className="film-proof"><div className="film-proof-icon"><Fingerprint/></div><small>VERITY CREDENTIAL CHECK</small><b>{formatStatus || "Registry integrity check"}</b><p>{verifyResult?.message || "Reference lookup · Record fingerprint · Revocation status"}</p><span>{chainActive?"ON-CHAIN STATUS AVAILABLE":"DATABASE LEDGER · NO LIVE CHAIN CLAIM"}</span><label className="film-reference-field"><span>Credential ID or verification key</span><input value={reference} onChange={e=>{setReference(e.target.value);setVerifyResult(null);}} placeholder="Enter a real Verity credential reference"/></label><button onClick={verifyActual} disabled={!onVerify||!reference.trim()}>Run actual credential check</button></div>}
      </div>
      <div className="film-corner">VERITY <b>{String(scene+1).padStart(2,"0")}</b> / 08</div>
    </div>
    <div className="film-controls">
      <div className="film-progress"><div style={{width:progress+"%"}}/><i style={{left:progress+"%"}}/></div>
      <div className="film-control-row"><div className="film-buttons"><button onClick={()=>playing?setPlaying(false):elapsed>=duration?replay():setPlaying(true)}>{playing?<Pause/>:<Play/>}{playing?"Pause":elapsed>=duration?"Replay":"Play film"}</button><button className="film-icon-button" onClick={replay} aria-label="Replay"><RotateCcw/></button><button className="film-icon-button" onClick={skip} aria-label="Skip scene"><SkipForward/></button></div><div className="film-timing"><b>{String(Math.floor(elapsed/60000)).padStart(2,"0")}:{String(Math.floor((elapsed%60000)/1000)).padStart(2,"0")}</b><span> / 00:58</span></div></div>
      <div className="film-scene-dots">{scenes.map((item,i)=><button key={item.kicker} className={scene===i?"active":""} onClick={()=>{setScene(i);setElapsed(i*(duration/scenes.length));setPlaying(false);}} aria-label={"Go to scene "+(i+1)} title={item.label}/>)}</div>
    </div>
    <p className="film-footnote">This in-app product film uses live dashboard totals and available credential data. Actions such as the credential check call Verity’s authenticated verification workflow; the film does not invent blockchain confirmations.</p>
  </section>;
}
