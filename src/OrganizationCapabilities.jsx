import React,{useEffect,useState} from "react";
import {ShieldCheck,CheckCircle2,Clock3,AlertTriangle,Send} from "lucide-react";

const api=async(path,opts={})=>{
 const token=localStorage.getItem("verity_token");
 const response=await fetch("/api"+path,{...opts,headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{}),...opts.headers}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||"Request failed");
 return data;
};

const labels={
 ISSUE_CREDENTIALS:{title:"Issue credentials",description:"Manage graduate records and issue certificates using VERITY's existing templates, uploads and issuance workflows."},
 VERIFY_CREDENTIALS:{title:"Verify credentials",description:"Verify credentials issued by other organizations and request original documents only with graduate consent."}
};

export default function OrganizationCapabilities({organization,notice}){
 const [items,setItems]=useState([]),[busy,setBusy]=useState(""),[error,setError]=useState("");
 async function load(){
  if(!organization?.id)return;
  try{const data=await api("/organization/capabilities");setItems(data.capabilities||[]);setError("");}
  catch(e){setError(e.message);}
 }
 const capabilitySignature=(organization?.capabilities||[]).map(x=>x.capability+":"+x.status).sort().join("|");
 useEffect(()=>{load();},[organization?.id,capabilitySignature]);
 async function request(capability){
  setBusy(capability);setError("");
  try{
   const data=await api("/organization/capabilities",{method:"POST",body:JSON.stringify({capability})});
   notice?.(data.message||"Capability request submitted.");
   await load();
  }catch(e){setError(e.message);}
  finally{setBusy("");}
 }
 const byCapability=new Map(items.map(item=>[item.capability,item]));
 return <section className="panel">
  <div className="panel-head"><div><h3>Organization service permissions</h3><p>Issuing and verifying are separate permissions. Each request is reviewed independently by a VERITY administrator.</p></div><ShieldCheck size={25}/></div>
  <div className="capability-grid">
   {Object.entries(labels).map(([key,meta])=>{
    const item=byCapability.get(key),status=item?.status||"NOT_REQUESTED";
    const approved=status==="APPROVED",pending=status==="PENDING",suspended=status==="SUSPENDED";
    return <article className="capability-card" key={key}>
     <div className="capability-card-head"><b>{meta.title}</b><span className={"review-status "+(approved?"approved":pending?"pending":suspended?"suspended":"")}>{status.replaceAll("_"," ")}</span></div>
     <p>{meta.description}</p>
     {item?.decisionNote&&<small className="muted">Review note: {item.decisionNote}</small>}
     {!approved&&!suspended&&<button type="button" className="btn-outline" disabled={!!busy||pending} onClick={()=>request(key)}>
      {busy===key?"Submitting…":pending?<><Clock3 size={14}/> Awaiting review</>:status==="REJECTED"?"Resubmit request":<><Send size={14}/> Request permission</>}
     </button>}
     {approved&&<div className="capability-approved"><CheckCircle2 size={16}/> Approved by VERITY</div>}
     {suspended&&<div className="capability-suspended"><AlertTriangle size={16}/> Suspended. Contact VERITY support.</div>}
    </article>;
   })}
  </div>
  {organization?.status!=="APPROVED"&&<p className="muted">Your organization identity application must be approved before any requested capability can be approved. Existing service permissions remain subject to organization approval.</p>}
  {error&&<p className="error">{error}</p>}
 </section>;
}
