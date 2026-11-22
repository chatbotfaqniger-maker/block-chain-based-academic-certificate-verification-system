import React,{useEffect,useState} from "react";
import {AlertCircle,CheckCircle2,Clock3,LifeBuoy,RefreshCw,Send,ShieldCheck} from "lucide-react";

const api=async(path,opts={})=>{
 const token=localStorage.getItem("verity_token");
 const response=await fetch("/api"+path,{...opts,headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{}),...opts.headers}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||"Request failed.");
 return data;
};
const date=value=>value?new Date(value).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"}):"—";
const categories=[["ACCOUNT","Account and sign-in"],["CERTIFICATE","Certificate records"],["VERIFICATION","Credential verification"],["DOCUMENT_UPLOAD","Document upload"],["ACCESS","Permissions and access"],["DATA_CORRECTION","Data correction"],["PERFORMANCE","Slow or unavailable service"],["OTHER","Other"]];
const statuses=["OPEN","IN_PROGRESS","WAITING_FOR_USER","RESOLVED","CLOSED"];
export default function IssueCentre({user,organization,notice}){
 const admin=user?.role==="ADMIN",institutionOwner=user?.role==="EMPLOYER"&&organization?.type==="INSTITUTION";
 const [issues,setIssues]=useState([]),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const [form,setForm]=useState({category:"OTHER",severity:"NORMAL",subject:"",description:""});
 const [notes,setNotes]=useState({});
 async function load(){
  setLoading(true);setError("");
  try{const result=await api("/issues");setIssues(result.issues||[]);}
  catch(e){setError(e.message);}
  finally{setLoading(false);}
 }
 useEffect(()=>{load();},[]);
 async function submit(e){
  e.preventDefault();setBusy(true);setError("");
  try{const result=await api("/issues",{method:"POST",body:JSON.stringify(form)});notice("Issue submitted. Reference: "+result.issue.ticketNumber);setForm({category:"OTHER",severity:"NORMAL",subject:"",description:""});await load();}
  catch(e){setError(e.message);}
  finally{setBusy(false);}
 }
 async function update(item,status){
  setBusy(true);setError("");
  try{await api("/issues/"+item.id,{method:"PATCH",body:JSON.stringify({status,...(admin?{resolutionNotes:notes[item.id]??item.resolutionNotes??""}:{})})});notice("Issue "+status.toLowerCase().replaceAll("_"," ") + ".");await load();}
  catch(e){setError(e.message);}
  finally{setBusy(false);}
 }
 const counts={open:issues.filter(x=>x.status==="OPEN").length,progress:issues.filter(x=>x.status==="IN_PROGRESS").length,resolved:issues.filter(x=>["RESOLVED","CLOSED"].includes(x.status)).length};
 return <div className="issue-centre">
  <section className="panel issue-hero"><div className="issue-hero-icon"><LifeBuoy size={25}/></div><div><span className="eyebrow">VERITY SUPPORT & OPERATIONS</span><h3>Issue Resolution Centre</h3><p>Report a problem, follow its progress and receive a documented resolution. Verity only offers repair actions when the operation is safe and authorized.</p></div><button type="button" className="btn-outline" onClick={load} disabled={loading}><RefreshCw size={15}/> Refresh</button></section>
  <div className="issue-stats"><div className="stat"><small>Open reports</small><strong>{counts.open}</strong></div><div className="stat"><small>In progress</small><strong>{counts.progress}</strong></div><div className="stat"><small>Resolved / closed</small><strong>{counts.resolved}</strong></div></div>
  <section className="panel"><div className="panel-head"><div><h3>Report an issue</h3><p>Do not include passwords, private keys, full identity documents or other sensitive information.</p></div><AlertCircle size={21}/></div>
   <form className="issue-form" onSubmit={submit}>
    <label>Issue category<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{categories.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    <label>Impact level<select value={form.severity} onChange={e=>setForm({...form,severity:e.target.value})}><option value="LOW">Low — minor inconvenience</option><option value="NORMAL">Normal — work can continue</option><option value="HIGH">High — important workflow blocked</option><option value="CRITICAL">Critical — major service unavailable</option></select></label>
    <label className="issue-wide">Short title<input minLength={5} maxLength={140} value={form.subject} onChange={e=>setForm({...form,subject:e.target.value})} placeholder="e.g. Certificate upload remains pending" required/></label>
    <label className="issue-wide">What happened? Include the page, action and any visible error message.<textarea minLength={15} maxLength={4000} rows={4} value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Describe what you expected, what happened instead, and when you noticed it…" required/></label>
    {error&&<div className="error issue-wide">{error}</div>}
    <div className="issue-wide issue-submit"><small>Reports are linked to your account{institutionOwner&&organization?.name?" and institution":""}.</small><button className="primary" disabled={busy}>{busy?"Submitting…":<><Send size={15}/> Submit issue report</>}</button></div>
   </form>
  </section>
  <section className="panel"><div className="panel-head"><div><h3>{admin?"Platform issue queue":institutionOwner?"Institution issue queue":"My issue reports"}</h3><p>{admin?"Review platform-wide reports and record administrative resolutions.":institutionOwner?"Review reports associated with your institution and update their progress.":"Track your submitted reports and their latest status."}</p></div><span className="issue-count">{issues.length} report{issues.length===1?"":"s"}</span></div>
   {loading?<p className="muted">Loading issue reports…</p>:issues.length?issues.map(item=><article className="issue-card" key={item.id}>
    <div className="issue-card-top"><div><span className="eyebrow">{item.ticketNumber} · {item.category.replaceAll("_"," ")}</span><h4>{item.subject}</h4><small>Submitted {date(item.createdAt)} · {item.organization?.name||"Personal report"}</small></div><span className={"issue-status "+item.status.toLowerCase()}>{item.status.replaceAll("_"," ")}</span></div>
    <p className="issue-description">{item.description}</p>
    <div className="issue-meta"><span>Impact: <b>{item.severity}</b></span><span>Updated: {date(item.updatedAt)}</span></div>
    {item.resolutionNotes&&<div className="issue-resolution"><b>Resolution update</b><p>{item.resolutionNotes}</p></div>}
    {(admin||institutionOwner)&&!["CLOSED","RESOLVED"].includes(item.status)&&<div className="issue-actions">
      {admin&&<label className="issue-wide">Resolution notes<textarea rows={2} maxLength={2000} value={notes[item.id]??item.resolutionNotes??""} onChange={e=>setNotes({...notes,[item.id]:e.target.value})} placeholder="Record what was checked or changed. Do not claim a repair until verified."/></label>}
      <div className="actions">{statuses.filter(status=>status!==item.status&&status!=="OPEN").map(status=><button type="button" key={status} className={status==="RESOLVED"?"btn-approve":"btn-outline"} disabled={busy} onClick={()=>update(item,status)}>{status.replaceAll("_"," ")}</button>)}</div>
    </div>}
   </article>):<div className="issue-empty"><ShieldCheck size={25}/><b>No issue reports yet</b><p>When you submit a report, its reference and status will appear here.</p></div>}
  </section>
  <p className="issue-footnote"><Clock3 size={14}/> Automatic repair is not assumed. VERITY records confirmed actions and escalates privileged or infrastructure-level work to the System Administrator.</p>
 </div>;
}
