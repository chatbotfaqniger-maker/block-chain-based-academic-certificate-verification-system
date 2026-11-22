import React,{useCallback,useEffect,useMemo,useState} from "react";
import {AlertCircle,ArrowUpRight,CheckCircle2,Clock3,LifeBuoy,MessageCircle,RefreshCw,Search,Send,ShieldCheck,Paperclip,Headphones} from "lucide-react";

const api=async(path,opts={})=>{
 const token=localStorage.getItem("verity_token");
 const response=await fetch("/api"+path,{...opts,headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{}),...opts.headers}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||"Request failed.");
 return data;
};
const date=value=>value?new Date(value).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—";
const categories=[["ACCOUNT","Account and sign-in"],["CERTIFICATE","Certificate records"],["VERIFICATION","Credential verification"],["DOCUMENT_UPLOAD","Document upload"],["ACCESS","Permissions and access"],["DATA_CORRECTION","Data correction"],["PERFORMANCE","Slow or unavailable service"],["OTHER","Other"]];
const states=["OPEN","IN_PROGRESS","WAITING_FOR_USER","RESOLVED","CLOSED"];
export default function IssueCentre({user,organization,notice}){
 const admin=user?.role==="ADMIN",organizationOwner=user?.role==="EMPLOYER"&&Boolean(organization?.id);
 const [issues,setIssues]=useState([]),[selected,setSelected]=useState(null),[messages,setMessages]=useState([]),[draft,setDraft]=useState(""),[selectedFiles,setSelectedFiles]=useState([]),[uploading,setUploading]=useState(false);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[chatLoading,setChatLoading]=useState(false),[error,setError]=useState(""),[filter,setFilter]=useState("ALL"),[search,setSearch]=useState("");
 const [form,setForm]=useState({category:"OTHER",severity:"NORMAL",subject:"",description:""}),[showForm,setShowForm]=useState(false);
 const load=useCallback(async(silent=false)=>{if(!silent)setLoading(true);try{const result=await api("/issues");setIssues(result.issues||[]);setSelected(current=>current?(result.issues||[]).find(x=>x.id===current.id)||null:current);setError("");}catch(e){setError(e.message);}finally{if(!silent)setLoading(false);}},[]);
 const loadMessages=useCallback(async(id,silent=false)=>{if(!id)return;if(!silent)setChatLoading(true);try{const result=await api("/issues/"+id+"/messages");setMessages(result.messages||[]);}catch(e){setError(e.message);}finally{if(!silent)setChatLoading(false);}},[]);
 useEffect(()=>{load();},[load]);
 useEffect(()=>{if(!selected?.id){setMessages([]);return;}loadMessages(selected.id);const timer=setInterval(()=>loadMessages(selected.id,true),5000);return()=>clearInterval(timer);},[selected?.id,loadMessages]);
 useEffect(()=>{const timer=setInterval(()=>load(true),12000);return()=>clearInterval(timer);},[load]);
 async function submit(e){e.preventDefault();setBusy(true);setError("");try{const r=await api("/issues",{method:"POST",body:JSON.stringify(form)});notice("Support conversation opened · "+r.issue.ticketNumber);setForm({category:"OTHER",severity:"NORMAL",subject:"",description:""});setShowForm(false);await load();setSelected(r.issue);}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function send(e){e.preventDefault();if((!draft.trim()&&!selectedFiles.length)||!selected)return;setBusy(true);setUploading(true);setError("");try{
  const token=localStorage.getItem("verity_token"),attachments=[];
  for(const file of selectedFiles){
   const response=await fetch("/api/issues/"+selected.id+"/attachments",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/octet-stream","X-File-Name":encodeURIComponent(file.name),"X-File-Type":file.type||"application/octet-stream"},body:file});
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(result.error||"File upload failed.");
   attachments.push(result.attachment);
  }
  await api("/issues/"+selected.id+"/messages",{method:"POST",body:JSON.stringify({body:draft.trim()||"Shared attachment(s).",attachments})});
  setDraft("");setSelectedFiles([]);await loadMessages(selected.id,true);await load(true);
 }catch(e){setError(e.message);}finally{setBusy(false);setUploading(false);}}
 async function openAttachment(attachment){try{const result=await api("/issues/"+selected.id+"/attachments?path="+encodeURIComponent(attachment.path));window.open(result.url,"_blank","noopener,noreferrer");}catch(e){setError(e.message);}}
 async function updateStatus(status){if(!selected)return;setBusy(true);setError("");try{await api("/issues/"+selected.id,{method:"PATCH",body:JSON.stringify({status})});notice("Conversation status updated.");await load(true);}catch(e){setError(e.message);}finally{setBusy(false);}}
 const counts=useMemo(()=>({open:issues.filter(x=>x.status==="OPEN").length,active:issues.filter(x=>["IN_PROGRESS","WAITING_FOR_USER"].includes(x.status)).length,closed:issues.filter(x=>["RESOLVED","CLOSED"].includes(x.status)).length}),[issues]);
 const visible=issues.filter(x=>(filter==="ALL"||x.status===filter)&&((x.subject+" "+x.ticketNumber+" "+(x.organization?.name||"")).toLowerCase().includes(search.toLowerCase())));
 return <div className="support-centre">
  <section className="support-hero"><div className="support-hero-mark"><Headphones size={25}/></div><div className="support-hero-copy"><span className="eyebrow">VERITY · DIRECT SUPPORT</span><h2>Support & Communication Centre</h2><p>A direct, private support conversation between your organization and the VERITY Admin team.</p></div><button className="support-new-button" onClick={()=>setShowForm(v=>!v)}><MessageCircle size={16}/>{showForm?"Close form":"New conversation"}</button></section>
  <div className="support-metrics"><div><small>Open conversations</small><strong>{counts.open}</strong></div><div><small>Being handled</small><strong>{counts.active}</strong></div><div><small>Resolved</small><strong>{counts.closed}</strong></div></div>
  {showForm&&<section className="support-new panel"><div className="panel-head"><div><h3>Start a support conversation</h3><p>Describe the issue clearly. VERITY Admin will be able to reply in this private thread.</p></div><ShieldCheck size={20}/></div><form className="issue-form" onSubmit={submit}>
   <label>Topic<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{categories.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
   <label>Priority<select value={form.severity} onChange={e=>setForm({...form,severity:e.target.value})}><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="CRITICAL">Critical</option></select></label>
   <label className="issue-wide">Subject<input minLength={5} maxLength={140} required value={form.subject} onChange={e=>setForm({...form,subject:e.target.value})} placeholder="What do you need help with?"/></label>
   <label className="issue-wide">Message<textarea rows={4} minLength={15} maxLength={4000} required value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Explain what happened, the page or workflow involved, and any visible error. Do not include passwords or private keys."/></label>
   <div className="issue-wide support-form-foot"><small>Your conversation is visible only to its authorized participants and VERITY Admin.</small><button className="primary" disabled={busy}>{busy?"Opening…":<><Send size={15}/> Open conversation</>}</button></div>
  </form></section>}
  {error&&<div className="error support-error">{error}<button onClick={()=>setError("")}>×</button></div>}
  <section className="support-workspace">
   <aside className="support-inbox">
    <div className="support-inbox-head"><div><h3>{admin?"Admin support inbox":"Your support inbox"}</h3><small>{admin?"All organizations and institutions":"Private conversations with VERITY Admin"}</small></div><button className="icon-button" title="Refresh" onClick={()=>load()}><RefreshCw size={16}/></button></div>
    <div className="support-search"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search conversations"/></div>
    <div className="support-filters">{[["ALL","All"],["OPEN","Open"],["IN_PROGRESS","In progress"],["WAITING_FOR_USER","Awaiting reply"],["RESOLVED","Resolved"]].map(([v,l])=><button key={v} className={filter===v?"active":""} onClick={()=>setFilter(v)}>{l}</button>)}</div>
    <div className="support-thread-list">{loading?<p className="muted support-empty">Loading conversations…</p>:visible.length?visible.map(item=><button key={item.id} className={"support-thread-preview "+(selected?.id===item.id?"selected":"")} onClick={()=>setSelected(item)}>
      <div className="support-preview-top"><span className="support-ticket">{item.ticketNumber}</span><span className={"issue-status "+item.status.toLowerCase()}>{item.status.replaceAll("_"," ")}</span></div>
      <b>{item.subject}</b><small>{item.organization?.name||"Individual user"} · {date(item.updatedAt)}</small><p>{item.description}</p>
    </button>):<div className="support-empty"><MessageCircle size={22}/><b>No conversations found</b><small>Start a new conversation when you need help.</small></div>}</div>
   </aside>
   <main className="support-chat">
    {selected?<><header className="support-chat-head"><div className="support-chat-avatar"><LifeBuoy size={19}/></div><div className="support-chat-title"><b>{selected.subject}</b><small>{selected.ticketNumber} · {selected.organization?.name||"Personal support"} · {selected.severity} priority</small></div><span className={"issue-status "+selected.status.toLowerCase()}>{selected.status.replaceAll("_"," ")}</span></header>
     <div className="support-context"><AlertCircle size={15}/><span>{selected.description}</span></div>
     <div className="support-messages">{chatLoading&&!messages.length?<p className="muted">Loading conversation…</p>:messages.length?messages.map(m=><div key={m.id} className={"support-message-row "+(m.authorId===user?.id?"mine":"")}>
       <div className="support-message-avatar">{(m.authorName||"V").split(" ").slice(0,2).map(x=>x[0]).join("").toUpperCase()}</div><div className="support-message-body"><div className="support-message-meta"><b>{m.authorId===user?.id?"You":m.authorName||"VERITY Admin"}</b><span>{m.authorRole==="ADMIN"?"VERITY ADMIN":m.authorRole||"USER"} · {date(m.createdAt)}</span></div><div className="support-bubble">{m.body}</div>{Array.isArray(m.attachments)&&m.attachments.length>0&&<div className="support-attachments">{m.attachments.map((a,i)=><button type="button" key={a.path||i} onClick={()=>openAttachment(a)}><Paperclip size={13}/><span>{a.fileName}</span><small>{Math.max(1,Math.round((a.size||0)/1024))} KB</small><ArrowUpRight size={12}/></button>)}</div>}</div>
      </div>):<div className="support-empty"><MessageCircle size={25}/><b>Conversation started</b><small>Send a message to begin talking with VERITY Admin.</small></div>}</div>
     {selected.status!=="CLOSED"&&<form className="support-composer" onSubmit={send}><textarea rows={2} maxLength={5000} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Write a message to VERITY Admin…" /><div className="support-composer-actions"><label className="support-attach-button" title="Attach files"><Paperclip size={17}/><input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,text/plain,.doc,.docx,.xls,.xlsx" onChange={e=>{const incoming=Array.from(e.target.files||[]);setSelectedFiles(current=>[...current,...incoming].slice(0,5));e.target.value="";}}/></label><button disabled={busy||(!draft.trim()&&!selectedFiles.length)} aria-label="Send message"><Send size={17}/></button></div><small>Attach up to 5 files per message · 10 MB each · Images, PDF, Word, Excel or text. Never send passwords or private keys.</small>{selectedFiles.length>0&&<div className="support-selected-files">{selectedFiles.map((file,i)=><span key={i}><Paperclip size={12}/>{file.name}<button type="button" onClick={()=>setSelectedFiles(current=>current.filter((_,n)=>n!==i))}>×</button></span>)}</div>}{uploading&&<small className="support-uploading">Uploading attachments securely…</small>}</form>}
     {(admin||organizationOwner)&&<div className="support-admin-tools"><span>Conversation status</span><select value={selected.status} disabled={busy} onChange={e=>updateStatus(e.target.value)}>{states.map(x=><option key={x} value={x}>{x.replaceAll("_"," ")}</option>)}</select>{admin&&<small>Admin controls · status changes are recorded in the audit history</small>}</div>}
    </>:<div className="support-no-selection"><div><Headphones size={34}/></div><h3>Your direct line to VERITY Admin</h3><p>Select a conversation to view messages, or open a new one to get assistance from the VERITY team.</p><button className="primary" onClick={()=>setShowForm(true)}>Start a conversation <ArrowUpRight size={15}/></button></div>}
   </main>
  </section>
  <p className="support-footnote"><Clock3 size={14}/> Replies refresh automatically. This is a private support channel, not a public organization directory or certificate verification record.</p>
 </div>;
}
