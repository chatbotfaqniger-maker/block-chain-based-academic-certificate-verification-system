import React,{useEffect,useState} from "react";
import {CheckCircle2,AlertTriangle,Clock3,ShieldCheck} from "lucide-react";

const api=async(path,opts={})=>{
 const token=localStorage.getItem("verity_token");
 const response=await fetch("/api"+path,{...opts,headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{}),...opts.headers}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||"Request failed");
 return data;
};

export default function AdminCapabilityReviews({notice}){
 const [items,setItems]=useState([]),[busy,setBusy]=useState(""),[notes,setNotes]=useState({}),[error,setError]=useState("");
 async function load(){
  try{const data=await api("/admin/organization-capabilities");setItems(data.requests||[]);setError("");}
  catch(e){setError(e.message);}
 }
 useEffect(()=>{load();},[]);
 async function decide(item,status){
  setBusy(item.id);setError("");
  try{
   await api("/admin/organization-capabilities/"+item.id,{method:"PATCH",body:JSON.stringify({status,decisionNote:notes[item.id]||""})});
   notice?.("Capability request "+status.toLowerCase()+".");
   await load();
  }catch(e){setError(e.message);}
  finally{setBusy("");}
 }
 const pending=items.filter(x=>x.status==="PENDING");
 return <section className="panel admin-registry">
  <div className="registry-heading"><div><span className="eyebrow">SEPARATE PERMISSION REVIEW</span><h3>Organization capability approvals</h3><p>Review credential issuance and external verification permissions independently of organization identity approval.</p></div><span className="registry-count">{pending.length} awaiting review</span></div>
  {pending.length?pending.map(item=>{
   const org=item.organization||{},canApprove=org.status==="APPROVED";
   return <article className="org-review-card" key={item.id}>
    <div className="org-review-top"><div><span className="eyebrow">{item.capability.replaceAll("_"," ")}</span><h4>{org.name||"Organization"}</h4><small>{org.type||"Organization"} · Identity status: {org.status||"Unknown"}</small></div><span className="review-status pending">PENDING</span></div>
    {item.requestNote&&<p>{item.requestNote}</p>}
    <label className="reviewer-label">Capability decision notes<textarea rows="2" value={notes[item.id]??item.decisionNote??""} onChange={e=>setNotes(v=>({...v,[item.id]:e.target.value}))} placeholder="Record the scope and evidence reviewed for this permission…"/></label>
    {!canApprove&&<p className="muted">Approve the organization identity application first. This permission cannot be approved while the organization is pending or suspended.</p>}
    <div className="org-review-actions"><span className="review-hint">Request submitted {new Date(item.createdAt).toLocaleDateString("en-GB")}</span><div className="actions">
     <button type="button" className="btn-approve" disabled={!!busy||!canApprove} onClick={()=>decide(item,"APPROVED")}><CheckCircle2 size={15}/> Approve permission</button>
     <button type="button" className="btn-danger" disabled={!!busy} onClick={()=>decide(item,"REJECTED")}><AlertTriangle size={15}/> Reject</button>
    </div></div>
   </article>;
  }):<p className="muted">No capability requests are waiting for review.</p>}
  {items.some(x=>x.status!=="PENDING")&&<details className="directory-profile-details"><summary>View previous capability decisions ({items.filter(x=>x.status!=="PENDING").length})</summary>{items.filter(x=>x.status!=="PENDING").map(item=><div className="rowitem" key={item.id}><div><b>{item.organization?.name||"Organization"} · {item.capability.replaceAll("_"," ")}</b><small>{item.status} · {item.decisionNote||"No decision note"}</small></div></div>)}</details>}
  {error&&<p className="error">{error}</p>}
 </section>;
}
