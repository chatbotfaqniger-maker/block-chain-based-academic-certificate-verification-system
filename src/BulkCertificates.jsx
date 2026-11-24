// Capability-gated bulk credential issuance; all methods reuse the existing VERITY pipeline. Each credential reuses the existing server-side issue and document endpoints.
import React,{useEffect,useMemo,useState} from "react";
import {MAX_CAMPAIGN_ITEMS,PROCESSING_BATCH_SIZE,getIssuanceChunk} from "./issuance-campaign.js";
import {FileSpreadsheet,FileArchive,Files,FileText,Upload,AlertTriangle,CheckCircle2,ShieldCheck,ArrowRight,Download} from "lucide-react";

const TEMPLATE="student_number,full_name,email,faculty,department,programme,qualification,classification,award_date\n2021/CS/001,Example Student,student@example.edu.ng,Science,Computer Science,Computer Science,Bachelor of Science,Second Class Upper,2026-10-15\n";
const normalizeNumber=value=>String(value||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
function parseCsv(source){
 source=source.replace(/^\uFEFF/,"");const rows=[];let row=[],cell="",quoted=false;
 for(let i=0;i<source.length;i++){const ch=source[i],next=source[i+1];if(ch==='"'&&quoted&&next==='"'){cell+='"';i++;}else if(ch==='"')quoted=!quoted;else if(ch===","&&!quoted){row.push(cell);cell="";}else if((ch==="\n"||ch==="\r")&&!quoted){if(ch==="\r"&&next==="\n")i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell="";}else cell+=ch;}
 if(cell.length||row.length){row.push(cell);if(row.some(v=>v.trim()))rows.push(row);}if(quoted)throw Error("The CSV contains an unfinished quoted field.");if(rows.length<2)throw Error("Add at least one student row.");if(rows.length>MAX_CAMPAIGN_ITEMS+1)throw Error("A single issuance campaign supports up to 8,000 student rows. The institution has an 8,000-record allowance across all campaigns per UTC calendar month.");
 const headers=rows[0].map(v=>v.trim().toLowerCase().replace(/\s+/g,"_"));const required=["student_number","full_name","faculty","department","programme","qualification","award_date"];const missing=required.filter(k=>!headers.includes(k));if(missing.length)throw Error("Missing required columns: "+missing.join(", "));
 const seen=new Set();return rows.slice(1).map((values,index)=>{const x=Object.fromEntries(headers.map((h,i)=>[h,(values[i]||"").trim()]));const studentNumber=x.student_number||"";const key=normalizeNumber(studentNumber);const awardDate=x.award_date||"";const errors=[];if(!key)errors.push("Student number is required.");if(!awardDate)errors.push("Award date is required.");if(seen.has(key))errors.push("Duplicate student number in CSV.");seen.add(key);for(const k of ["full_name","faculty","department","programme","qualification"])if(!x[k])errors.push("Missing "+k.replace("_"," ")+".");if(x.email&&(x.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.email)))errors.push("Invalid email address.");const d=new Date(awardDate+"T00:00:00.000Z");if(!/^\d{4}-\d{2}-\d{2}$/.test(awardDate)||Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==awardDate)errors.push("Award date must be YYYY-MM-DD.");return {rowNumber:index+2,studentNumber,studentName:x.full_name||"",studentEmail:x.email||"",faculty:x.faculty||"",department:x.department||"",programme:x.programme||"",qualification:x.qualification||"",classification:x.classification||"",awardDate,errors};});
}
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
async function inflateRaw(bytes,limit){if(typeof DecompressionStream==="undefined")throw Error("This browser cannot safely read ZIP archives. Extract the ZIP on your computer and select the PDFs individually.");const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));const reader=stream.getReader();const chunks=[];let total=0;while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>limit){await reader.cancel();throw Error("A ZIP entry expands beyond the 10 MB per-certificate limit.");}chunks.push(value);}const out=new Uint8Array(total);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}return out;}
async function readZip(file){
 const bytes=new Uint8Array(await file.arrayBuffer()),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let eocd=-1;for(let i=Math.max(0,bytes.length-65557);i<=bytes.length-22;i++)if(view.getUint32(i,true)===0x06054b50)eocd=i;
 if(eocd<0)throw Error("The selected file is not a valid ZIP archive.");if(view.getUint16(eocd+4,true)!==0||view.getUint16(eocd+6,true)!==0)throw Error("Multi-disk ZIP archives are not supported.");
 const count=view.getUint16(eocd+10,true),centralSize=view.getUint32(eocd+12,true),centralOffset=view.getUint32(eocd+16,true);if(count>50000||centralOffset+centralSize>bytes.length)throw Error("ZIP archive exceeds the supported file count or has an invalid directory.");
 const files=[];let p=centralOffset,total=0;for(let n=0;n<count;n++){if(view.getUint32(p,true)!==0x02014b50)throw Error("The ZIP central directory is malformed.");const flags=view.getUint16(p+8,true),method=view.getUint16(p+10,true),crc=view.getUint32(p+16,true),compressed=view.getUint32(p+20,true),uncompressed=view.getUint32(p+24,true),nameLen=view.getUint16(p+28,true),extraLen=view.getUint16(p+30,true),commentLen=view.getUint16(p+32,true),external=view.getUint32(p+38,true),localOffset=view.getUint32(p+42,true);const nameBytes=bytes.slice(p+46,p+46+nameLen);const name=new TextDecoder(flags&0x800?"utf-8":"utf-8",{fatal:true}).decode(nameBytes);p+=46+nameLen+extraLen+commentLen;if(name.endsWith("/"))continue;if(flags&1)throw Error("Encrypted ZIP entries are not supported.");if((external>>>16&0xf000)===0xa000)throw Error("ZIP archives containing symbolic links are not accepted.");if(!/\.pdf$/i.test(name))continue;if(uncompressed>10*1024*1024)throw Error("A certificate PDF exceeds 10 MB: "+name);total+=uncompressed;if(total>250*1024*1024)throw Error("The expanded certificate files exceed the 250 MB campaign limit.");if(view.getUint32(localOffset,true)!==0x04034b50)throw Error("A ZIP entry has an invalid local header.");const localName=view.getUint16(localOffset+26,true),localExtra=view.getUint16(localOffset+28,true),start=localOffset+30+localName+localExtra,compressedBytes=bytes.slice(start,start+compressed);let data;if(method===0)data=compressedBytes;else if(method===8)data=await inflateRaw(compressedBytes,10*1024*1024);else throw Error("Unsupported ZIP compression method.");if(data.length!==uncompressed||crc32(data)!==crc)throw Error("A ZIP PDF failed its integrity check: "+name);const safeName=name.split(/[\\/]/).pop();files.push(new File([data],safeName,{type:"application/pdf"}));if(files.length>MAX_CAMPAIGN_ITEMS)throw Error("A campaign can contain up to 8,000 certificate PDFs.");}
 return files;
}
async function readXlsx(file){
 const bytes=new Uint8Array(await file.arrayBuffer()),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let eocd=-1;
 for(let i=Math.max(0,bytes.length-65557);i<=bytes.length-22;i++)if(view.getUint32(i,true)===0x06054b50)eocd=i;
 if(eocd<0)throw Error("The Excel workbook is not a valid XLSX ZIP archive.");
 if(view.getUint16(eocd+4,true)!==0||view.getUint16(eocd+6,true)!==0)throw Error("Multi-disk Excel workbooks are not supported.");
 const count=view.getUint16(eocd+10,true),centralOffset=view.getUint32(eocd+16,true);if(count>3000)throw Error("The workbook contains too many ZIP entries.");
 const entries=new Map();let p=centralOffset,total=0;
 for(let n=0;n<count;n++){
  if(view.getUint32(p,true)!==0x02014b50)throw Error("The Excel workbook ZIP directory is malformed.");
  const flags=view.getUint16(p+8,true),method=view.getUint16(p+10,true),crc=view.getUint32(p+16,true),compressed=view.getUint32(p+20,true),size=view.getUint32(p+24,true),nl=view.getUint16(p+28,true),el=view.getUint16(p+30,true),cl=view.getUint16(p+32,true),external=view.getUint32(p+38,true),offset=view.getUint32(p+42,true);
  const name=new TextDecoder("utf-8",{fatal:true}).decode(bytes.slice(p+46,p+46+nl));p+=46+nl+el+cl;if(name.endsWith("/"))continue;
  if(flags&1||(external>>>16&0xf000)===0xa000)throw Error("Encrypted or linked ZIP entries are not accepted.");
  if(!["xl/workbook.xml","xl/_rels/workbook.xml.rels","xl/sharedStrings.xml"].includes(name)&&!/^xl\/worksheets\/sheet[^/]+\.xml$/.test(name))continue;
  if(size>15*1024*1024)throw Error("An Excel workbook component is too large.");total+=size;if(total>40*1024*1024)throw Error("The expanded workbook exceeds 40 MB.");
  if(view.getUint32(offset,true)!==0x04034b50)throw Error("An Excel workbook component has an invalid ZIP header.");
  const start=offset+30+view.getUint16(offset+26,true)+view.getUint16(offset+28,true),raw=bytes.slice(start,start+compressed);
  const data=method===0?raw:method===8?await inflateRaw(raw,15*1024*1024):null;if(!data)throw Error("Unsupported Excel workbook compression.");
  if(data.length!==size||crc32(data)!==crc)throw Error("An Excel workbook component failed its integrity check.");
  entries.set(name,new TextDecoder("utf-8").decode(data));
 }
 const parseXml=(name)=>{const source=entries.get(name);if(!source)throw Error("Excel workbook is missing "+name+".");const doc=new DOMParser().parseFromString(source,"application/xml");if(doc.querySelector("parsererror"))throw Error("The Excel workbook contains invalid XML.");return doc;};
 const workbook=parseXml("xl/workbook.xml"),rels=parseXml("xl/_rels/workbook.xml.rels"),firstSheet=workbook.getElementsByTagName("sheet")[0];if(!firstSheet)throw Error("The Excel workbook has no worksheet.");
 const relId=firstSheet.getAttribute("r:id"),relationship=[...rels.getElementsByTagName("Relationship")].find(x=>x.getAttribute("Id")===relId);if(!relationship)throw Error("The first Excel worksheet could not be located.");
 let target=relationship.getAttribute("Target")||"";target=target.startsWith("/")?target.slice(1):target.startsWith("xl/")?target:"xl/"+target;
 const sheet=parseXml(target),shared=entries.has("xl/sharedStrings.xml")?[...parseXml("xl/sharedStrings.xml").getElementsByTagName("si")].map(si=>[...si.getElementsByTagName("t")].map(t=>t.textContent||"").join("")):[];
 const colIndex=ref=>{let n=0;for(const ch of ref.match(/^[A-Z]+/i)?.[0]||"A")n=n*26+ch.toUpperCase().charCodeAt(0)-64;return n-1;};
 const matrix=[];for(const row of [...sheet.getElementsByTagName("row")]){const values=[];for(const cell of [...row.getElementsByTagName("c")]){const idx=colIndex(cell.getAttribute("r")||"A1"),type=cell.getAttribute("t"),v=cell.getElementsByTagName("v")[0]?.textContent||"";let value=type==="s"?(shared[Number(v)]||""):type==="inlineStr"?[...cell.getElementsByTagName("t")].map(t=>t.textContent||"").join(""):v;values[idx]=value;}matrix.push(values.map(x=>String(x??"")));if(matrix.length>MAX_CAMPAIGN_ITEMS+1)throw Error("A campaign can contain up to 8,000 student rows.");}
 if(matrix.length<2)throw Error("The first worksheet must contain a header and at least one student row.");
 const headers=matrix[0].map(x=>String(x||"").trim().toLowerCase().replace(/\s+/g,"_"));const dateCol=headers.indexOf("award_date");
 if(dateCol>=0)for(const row of matrix.slice(1)){const v=row[dateCol];if(/^\d+(\.\d+)?$/.test(v)){const date=new Date(Date.UTC(1899,11,30)+Number(v)*86400000);row[dateCol]=date.toISOString().slice(0,10);}}
 return matrix.map(row=>row.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")).join("\n");
}
function validateEditedRows(input){
 const seen=new Set();return input.map((row)=>{const errors=[],key=normalizeNumber(row.studentNumber),date=String(row.awardDate||"").trim();if(!key)errors.push("Student number is required.");if(!date)errors.push("Award date is required.");if(seen.has(key))errors.push("Duplicate student number in CSV.");seen.add(key);for(const [field,label] of [["studentName","full name"],["faculty","faculty"],["department","department"],["programme","programme"],["qualification","qualification"]])if(!String(row[field]||"").trim())errors.push("Missing "+label+".");if(row.studentEmail&&(row.studentEmail.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.studentEmail)))errors.push("Invalid email address.");const d=new Date(date+"T00:00:00.000Z");if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==date)errors.push("Award date must be YYYY-MM-DD.");return {...row,errors};});
}
function downloadTemplate(){const blob=new Blob([TEMPLATE],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="VERITY-bulk-certificate-template.csv";a.click();URL.revokeObjectURL(url);}
export default function BulkCertificates({api,notice,organization}){
 const [method,setMethod]=useState("zip"),[csvFile,setCsvFile]=useState(null),[rows,setRows]=useState([]),[pdfFiles,setPdfFiles]=useState([]),[fileError,setFileError]=useState(""),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[progress,setProgress]=useState({done:0,total:0}),[results,setResults]=useState([]),[generated,setGenerated]=useState(false),[history,setHistory]=useState([]),[activeBatchId,setActiveBatchId]=useState(null),[batchStatus,setBatchStatus]=useState(null),[workerEnabled,setWorkerEnabled]=useState(false),[pendingUpload,setPendingUpload]=useState(null),[campaignHistory,setCampaignHistory]=useState([]);
 const approved=organization?.status==="APPROVED"&&organization?.capabilities?.some(x=>x.capability==="ISSUE_CREDENTIALS"&&x.status==="APPROVED");
 useEffect(()=>{let active=true;Promise.all([api("/organization/certificates/bulk/batches"),api("/organization/certificates/bulk/campaigns")]).then(([b,c])=>{if(active){setHistory(b.batches||[]);setCampaignHistory(c.campaigns||[]);setWorkerEnabled(b.workerEnabled===true&&c.workerEnabled===true);}}).catch(e=>{if(active)setFileError(e.message);});return()=>{active=false;};},[api]);
 useEffect(()=>{if(!activeBatchId)return;let active=true,timer=null;const poll=async()=>{try{const d=await api("/organization/certificates/bulk/batches/"+encodeURIComponent(activeBatchId));if(!active)return;setBatchStatus(d.batch);setResults((d.items||[]).map(item=>({rowNumber:item.rowNumber,studentNumber:item.studentNumber,studentName:item.payload?.studentName||"",status:item.status,certificateId:item.certificateId||"",documentStatus:item.status==="ISSUED"?"UPLOADED":"",error:item.errorMessage||item.errorCode||""})));if(["COMPLETED","PARTIAL","FAILED","CANCELLED"].includes(d.batch.status)){setActiveBatchId(null);const [h,campaigns]=await Promise.all([api("/organization/certificates/bulk/batches"),api("/organization/certificates/bulk/campaigns")]);if(active){setHistory(h.batches||[]);setCampaignHistory(campaigns.campaigns||[]);setWorkerEnabled(h.workerEnabled===true&&campaigns.workerEnabled===true);}return;}}catch(e){if(active)setFileError("Unable to refresh batch status: "+e.message);}if(active)timer=setTimeout(poll,2500);};poll();return()=>{active=false;if(timer)clearTimeout(timer);};},[activeBatchId,api]);
 useEffect(()=>{if(!campaignHistory.some(c=>["UPLOADING","PROCESSING"].includes(c.status)))return;const timer=setInterval(()=>api("/organization/certificates/bulk/campaigns").then(r=>setCampaignHistory(r.campaigns||[])).catch(()=>{}),5000);return()=>clearInterval(timer);},[campaignHistory,api]);
 const readyRows=useMemo(()=>rows.filter(r=>!r.errors.length),[rows]);
 const matched=useMemo(()=>{if(method==="generate")return readyRows.map(r=>({...r,document:null,match:"Template generation"}));const byName=new Map();for(const f of pdfFiles){const key=normalizeNumber(f.name.replace(/\.pdf$/i,""));if(!byName.has(key))byName.set(key,[]);byName.get(key).push(f);}return readyRows.map(r=>{const key=normalizeNumber(r.studentNumber),files=byName.get(key)||[];return {...r,document:files.length===1?files[0]:null,match:files.length===1?"Matched":files.length>1?"Duplicate filename":"Missing PDF"};});},[readyRows,pdfFiles,method]);
 const unmatched=matched.filter(r=>r.match!=="Matched"&&method!=="generate");
 async function selectCsv(file){setCsvFile(file||null);setRows([]);setPdfFiles([]);setResults([]);setConfirmed(false);setFileError("");if(!file)return;const isXlsx=/\.xlsx$/i.test(file.name);if(!isXlsx&&!/\.csv$/i.test(file.name)){setFileError("Select a CSV or Excel .xlsx workbook.");return;}if(file.size>(isXlsx?15:5)*1024*1024){setFileError(isXlsx?"The XLSX workbook must be 15 MB or smaller.":"The CSV must be 5 MB or smaller.");return;}try{const source=isXlsx?await readXlsx(file):await file.text();const parsed=parseCsv(source);setRows(parsed);if(parsed.some(r=>r.errors.length))setFileError("Review and correct invalid spreadsheet rows before issuance. VERITY will not queue invalid rows.");else setFileError("");}catch(e){setFileError(e.message||"The spreadsheet could not be read.");}}
 async function selectZip(file){setPdfFiles([]);setFileError("");setResults([]);setConfirmed(false);if(!file)return;if(file.size>250*1024*1024){setFileError("ZIP archive must be 250 MB or smaller.");return;}try{const files=await readZip(file);setPdfFiles(files);if(!files.length)setFileError("No PDF files were found in this ZIP archive.");}catch(e){setFileError(e.message);}}
 function editStudent(rowNumber,field,value){setRows(current=>validateEditedRows(current.map(row=>row.rowNumber===rowNumber?{...row,[field]:value}:row)));setConfirmed(false);}
 function selectPdfs(list){const files=Array.from(list||[]);setPdfFiles(files);setFileError("");setResults([]);setConfirmed(false);const totalBytes=files.reduce((sum,file)=>sum+file.size,0);if(files.length>MAX_CAMPAIGN_ITEMS)setFileError("A campaign can contain up to 8,000 PDF certificates.");else if(totalBytes>250*1024*1024)setFileError("Selected PDFs must total 250 MB or less per campaign. Use multiple campaigns for larger document collections.");else if(files.some(f=>f.size>10*1024*1024))setFileError("Each certificate PDF must be 10 MB or smaller.");else if(files.some(f=>f.type!=="application/pdf"&&!/\.pdf$/i.test(f.name)))setFileError("Only PDF certificate files are accepted.");}
 async function issueBatch(){
  if(!approved||!confirmed||busy||!workerEnabled)return;
  let pending=pendingUpload;
  if(!pending){
    const selected=matched.filter(r=>method==="generate"||r.match==="Matched");
    if(!selected.length)return;
    const campaignMethod=method==="zip"?"CSV_ZIP":method==="multiple"?"CSV_MULTIPLE_PDFS":"CSV_GENERATED";
    pending={
      campaignId:crypto.randomUUID(),campaignCreated:false,campaignFileName:csvFile?.name||"VERITY-bulk-certificates.csv",
      campaignMethod,method,selectedRows:selected,itemIds:selected.map(()=>crypto.randomUUID()),
      batchIds:Array.from({length:Math.ceil(selected.length/PROCESSING_BATCH_SIZE)},()=>crypto.randomUUID()),
      nextIndex:0,batchId:null,batchStart:null,batchEnd:null,totalItems:selected.length
    };
    setPendingUpload(pending);
    setProgress({done:0,total:selected.length});
  }else{
    setProgress({done:pending.nextIndex,total:pending.selectedRows.length});
  }
  setBusy(true);
  let lastBatchId=null;
  try{
    // The client supplies stable identifiers so network timeouts can retry campaign creation.
    if(!pending.campaignCreated){
      await api("/organization/certificates/bulk/campaigns",{method:"POST",body:JSON.stringify({
        campaignId:pending.campaignId,fileName:pending.campaignFileName,
        method:pending.campaignMethod,totalItems:pending.totalItems
      })});
      pending={...pending,campaignCreated:true};setPendingUpload(pending);
    }
    // If the final item was staged but the completion response timed out,
    // finish that same durable chunk before moving to the next chunk or exiting.
    if(pending.batchId&&pending.batchEnd!==null&&pending.nextIndex>=pending.batchEnd){
      const completedBatchId=pending.batchId;
      const submitted=await api("/organization/certificates/bulk/batches/"+completedBatchId+"/complete",{method:"POST",body:JSON.stringify({})});
      lastBatchId=completedBatchId;
      pending={...pending,nextIndex:pending.batchEnd,batchId:null,batchStart:null,batchEnd:null};setPendingUpload(pending);
      if(submitted.batch)setHistory(old=>[submitted.batch,...old.filter(x=>x.id!==submitted.batch.id)].slice(0,25));
    }
    while(pending.nextIndex<pending.selectedRows.length){
      const chunk=getIssuanceChunk(pending.selectedRows,pending.nextIndex);
      const {start:chunkStart,end:chunkEnd,items:chunkRows,partNumber,totalParts}=chunk;
      let batchId=pending.batchId||pending.batchIds[partNumber-1];
      if(!pending.batchId){
        await api("/organization/certificates/bulk/batches",{method:"POST",body:JSON.stringify({
          campaignId:pending.campaignId,batchId,
          fileName:(pending.campaignFileName||"VERITY-bulk-certificates") .slice(0,70)+"-part-"+partNumber+"-of-"+totalParts,
          method:pending.campaignMethod,totalItems:chunkRows.length
        })});
        pending={...pending,batchId,batchStart:chunkStart,batchEnd:chunkEnd};setPendingUpload(pending);
      }
      for(let i=pending.nextIndex;i<chunkEnd;i++){
        const row=pending.selectedRows[i],itemId=pending.itemIds[i];
        let uploaded=null;
        if(pending.method!=="generate"){
          const doc=row.document;
          if(!doc)throw Error("A PDF is missing for "+row.studentNumber+". Re-select the original files and resume this campaign.");
          uploaded=await api("/organization/certificates/bulk/batches/"+batchId+"/items/"+itemId+"/document",{
            method:"POST",
            headers:{"Content-Type":"application/pdf","X-File-Name":encodeURIComponent(doc.name||("VERITY-"+row.studentNumber+".pdf"))},
            body:doc
          });
        }
        const payload={
          studentName:row.studentName,studentEmail:row.studentEmail||"",studentNumber:row.studentNumber,
          institution:organization.name,faculty:row.faculty,department:row.department,programme:row.programme,
          qualification:row.qualification,classification:row.classification||"",
          awardDate:new Date(row.awardDate+"T00:00:00.000Z").toISOString()
        };
        await api("/organization/certificates/bulk/batches/"+batchId+"/items",{
          method:"POST",body:JSON.stringify({
            itemId,rowNumber:row.rowNumber,payload,
            documentName:uploaded?.documentName||("VERITY-"+normalizeNumber(row.studentNumber)+".pdf"),
            ...(uploaded?.sha256?{documentSha256:uploaded.sha256}:{})
          })
        });
        pending={...pending,nextIndex:i+1,batchId};setPendingUpload(pending);
        setProgress({done:i+1,total:pending.selectedRows.length});
      }
      // Completion is idempotent. If its response is lost, retrying the same chunk is safe.
      const submitted=await api("/organization/certificates/bulk/batches/"+batchId+"/complete",{method:"POST",body:JSON.stringify({})});
      lastBatchId=batchId;
      pending={...pending,nextIndex:chunkEnd,batchId:null,batchStart:null,batchEnd:null};setPendingUpload(pending);
      if(submitted.batch)setHistory(old=>[submitted.batch,...old.filter(x=>x.id!==submitted.batch.id)].slice(0,25));
    }
    setActiveBatchId(lastBatchId);setPendingUpload(null);setConfirmed(false);setGenerated(true);
    setCsvFile(null);setRows([]);setPdfFiles([]);setFileError("");
    const campaigns=await api("/organization/certificates/bulk/campaigns");
    setCampaignHistory(campaigns.campaigns||[]);
    notice("Issuance campaign submitted successfully. "+Math.ceil(pending.selectedRows.length/PROCESSING_BATCH_SIZE)+" durable processing batches have been queued. VERITY will continue in the background.");
  }catch(e){
    setFileError(e.message+" Your campaign progress is saved in this session. Keep the selected files available and choose Resume interrupted campaign; already submitted processing batches will not be duplicated.");
  }finally{setBusy(false);}
 }
 function downloadReport(){const data=[["row","student_number","student_name","status","certificate_id","document_status","error"],...results.map(r=>[r.rowNumber,r.studentNumber,r.studentName,r.status,r.certificateId||"",r.documentStatus||"",r.error||""])];const csv=data.map(row=>row.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")).join("\n");const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="VERITY-bulk-issuance-results.csv";a.click();URL.revokeObjectURL(url);}
 const canRun=approved&&workerEnabled&&!busy&&(pendingUpload?true:readyRows.length>0&&!fileError&&(method==="generate"||(!unmatched.length&&pdfFiles.length>0)));
 return <div className="bulk-certificates">
 <section className="bulk-hero"><div><span className="eyebrow">ISSUER OPERATIONS</span><h2>Bulk certificate issuance</h2><p>Issue official credentials using your existing PDFs or VERITY's certificate layout. Every certificate passes through the standard issuer verification and audit workflow.</p></div><div className="bulk-hero-mark"><ShieldCheck size={30}/><b>VERITY</b><small>CERTIFICATE ISSUANCE</small></div></section>
 {!approved&&<div className="bulk-warning"><AlertTriangle size={18}/><span>Only organizations with approved ISSUE_CREDENTIALS permission can issue credentials. Verification-only organizations cannot issue.</span></div>}
 {!workerEnabled&&<div className="bulk-warning"><AlertTriangle size={18}/><span>Durable bulk issuance is not enabled on the production server yet. No certificates can be queued until the VERITY administrator configures the background worker and its server-only key.</span></div>}<section className="panel bulk-method-panel"><div className="panel-head"><div><h3>Choose your issuance method</h3><p>All methods use the same approved-issuer checks and certificate registry.</p></div></div><div className="bulk-methods">
 <button type="button" className={method==="zip"?"selected":""} disabled={busy||Boolean(pendingUpload)} onClick={()=>{setMethod("zip");setPdfFiles([]);setResults([]);setFileError("");setConfirmed(false);}}><FileArchive/><b>CSV + ZIP of PDFs</b><small>Upload student data and one ZIP containing matching certificate PDFs.</small></button>
 <button type="button" className={method==="multiple"?"selected":""} disabled={busy||Boolean(pendingUpload)} onClick={()=>{setMethod("multiple");setPdfFiles([]);setResults([]);setFileError("");setConfirmed(false);}}><Files/><b>CSV + multiple PDFs</b><small>Select the spreadsheet and all certificate files together.</small></button>
 <button type="button" className={method==="generate"?"selected":""} disabled={busy||Boolean(pendingUpload)} onClick={()=>{setMethod("generate");setPdfFiles([]);setResults([]);setFileError("");setConfirmed(false);}}><FileText/><b>Generate from template</b><small>VERITY renders each official PDF on the server using your organization’s approved active certificate design.</small></button>
 </div><div className="bulk-individual-note"><CheckCircle2 size={16}/> Individual certificate issuance remains available in the existing <b>Issue certificate</b> workspace.</div></section>
 <div className="bulk-grid"><section className="panel bulk-upload-panel"><div className="panel-head"><div><h3>1. Student data</h3><p>Upload a CSV or Excel workbook exported from your student information system.</p></div><FileSpreadsheet size={23}/></div><div className="bulk-template"><div><b>Download the official CSV template</b><small>Required: student number, full name, faculty, department, programme and qualification. Award date uses YYYY-MM-DD.</small></div><button type="button" className="btn-outline" onClick={downloadTemplate}><Download size={15}/> CSV template</button></div><label className="bulk-drop"><Upload size={22}/><b>{csvFile?.name||"Choose student CSV file"}</b><small>CSV up to 5 MB or XLSX up to 15 MB · up to 8,000 students per campaign</small><input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={!approved||busy||Boolean(pendingUpload)} onChange={e=>selectCsv(e.target.files?.[0]||null)}/></label>
 {method!=="generate"&&<><div className="bulk-section-divider"><span>2. Existing certificate PDFs</span></div>{method==="zip"?<label className="bulk-drop"><FileArchive size={22}/><b>Choose ZIP archive</b><small>PDF files only · 250 MB ZIP maximum · 10 MB per PDF</small><input type="file" accept=".zip,application/zip" disabled={!approved||busy||Boolean(pendingUpload)} onChange={e=>selectZip(e.target.files?.[0]||null)}/></label>:<label className="bulk-drop"><Files size={22}/><b>{pdfFiles.length?pdfFiles.length+" PDF files selected":"Choose multiple PDF files"}</b><small>Up to 8,000 PDFs · 250 MB total · maximum 10 MB each</small><input type="file" accept="application/pdf,.pdf" multiple disabled={!approved||busy||Boolean(pendingUpload)} onChange={e=>selectPdfs(e.target.files)}/></label>}<small className="bulk-footnote">File names must match the student's student or employee number, for example <b>2021-CS-001.pdf</b>. VERITY will not guess a match using student names.</small></>}
 {method==="generate"&&<div className="bulk-template-info"><b>Approved certificate design required</b><p>VERITY renders each PDF on the server from your organization’s approved active design, adds the individual verification QR and stores a SHA-256 document record. Approve a design in Certificate Design Studio before submitting this method. No local placeholder PDF is generated.</p></div>}
 {fileError&&<div className="bulk-errors"><b>Action required</b><p>{fileError}</p></div>}
 {rows.length>0&&<div className="bulk-preview"><div><b>3. Review records and document matching</b><span>{readyRows.length} valid / {rows.length} total</span></div><div className="bulk-preview-table"><table><thead><tr><th>Full name</th><th>Student number</th><th>Email</th><th>Faculty</th><th>Department</th><th>Programme</th><th>Qualification</th><th>Award date</th><th>PDF match</th><th>Validation</th></tr></thead><tbody>{matched.slice(0,100).map(r=><tr key={r.rowNumber}><td><input aria-label={"Full name row "+r.rowNumber} value={r.studentName} onChange={e=>editStudent(r.rowNumber,"studentName",e.target.value)}/></td><td><input aria-label={"Student number row "+r.rowNumber} value={r.studentNumber} onChange={e=>editStudent(r.rowNumber,"studentNumber",e.target.value)}/></td><td><input aria-label={"Email row "+r.rowNumber} value={r.studentEmail} onChange={e=>editStudent(r.rowNumber,"studentEmail",e.target.value)}/></td><td><input aria-label={"Faculty row "+r.rowNumber} value={r.faculty} onChange={e=>editStudent(r.rowNumber,"faculty",e.target.value)}/></td><td><input aria-label={"Department row "+r.rowNumber} value={r.department} onChange={e=>editStudent(r.rowNumber,"department",e.target.value)}/></td><td><input aria-label={"Programme row "+r.rowNumber} value={r.programme} onChange={e=>editStudent(r.rowNumber,"programme",e.target.value)}/></td><td><input aria-label={"Qualification row "+r.rowNumber} value={r.qualification} onChange={e=>editStudent(r.rowNumber,"qualification",e.target.value)}/></td><td><input aria-label={"Award date row "+r.rowNumber} type="date" value={r.awardDate} onChange={e=>editStudent(r.rowNumber,"awardDate",e.target.value)}/></td><td>{r.match}</td><td>{r.errors.length?r.errors.join(" "):"Ready"}</td></tr>)}</tbody></table></div><small>Spreadsheet preview is editable before submission. Showing up to 100 rows here; all {rows.length} imported rows are retained for validation and issuance. {method==="generate"?"VERITY will render one PDF per valid student from the organization's approved active design.":unmatched.length+" unmatched or duplicate PDF(s) block issuance. "}{rows.length>100?"Only the first 100 rows are displayed; edit or correct the source file and re-import for larger batches.":""}</small></div>}
 {results.length>0&&<div className="bulk-results"><div><b>Issuance results</b><button type="button" className="btn-outline" onClick={downloadReport}><Download size={14}/> Download report</button></div>{results.map((r,i)=><article key={i}><span className={r.status==="ISSUED"?"success":(r.status==="ISSUED_DOCUMENT_FAILED"||r.status==="NEEDS_REVIEW")?"warning":"failed"}>{r.status.replaceAll("_"," ")}</span><b>{r.studentName}</b><small>{r.studentNumber} · {r.certificateId||r.error}</small></article>)}</div>}
 {busy&&<div className="bulk-progress"><div><b>Issuing certificates</b><span>{progress.done} / {progress.total}</span></div><div className="bulk-progress-track"><i style={{width:(progress.total?progress.done/progress.total*100:0)+"%"}}/></div><small>Files are being staged privately. After submission, the server-side worker continues processing even if you leave this page.</small></div>}
 {rows.length>0&&<label className="bulk-confirm"><input type="checkbox" checked={confirmed} disabled={!canRun} onChange={e=>setConfirmed(e.target.checked)}/><span>I have reviewed the student records and document matches. I authorize VERITY to issue the selected certificates for this organization.</span></label>}
 <button className="primary bulk-issue-button" disabled={!canRun||!confirmed} onClick={issueBatch}>{busy?"Staging certificate batch…":pendingUpload?"Resume interrupted campaign":"Confirm and queue "+(method==="generate"?readyRows.length:matched.filter(r=>r.match==="Matched").length)+" certificates"}</button>
 <small className="bulk-footnote">Each institution may reserve up to 8,000 certificates across all issuance campaigns per UTC calendar month. This is a shared monthly allowance, not 8,000 per campaign. Each campaign is limited to 8,000 records and is automatically divided into durable 500-item processing chunks. If staging is interrupted, resume the same campaign; retries do not reserve the allowance twice.</small>
 </section>
 <section className="panel bulk-history"><div className="panel-head"><div><h3>Issuance controls</h3><p>How VERITY protects bulk issuance.</p></div><ShieldCheck size={22}/></div>
 <div className="bulk-history-list"><b>Recent issuance campaigns</b>{campaignHistory.length?campaignHistory.map(c=><div className="bulk-campaign-row" key={c.id}><span><b>{c.fileName}</b><small>{Number(c.allocatedItems||0).toLocaleString()} / {Number(c.totalItems).toLocaleString()} allocated · {Number(c.issuedItems||0).toLocaleString()} issued · {Number(c.failedItems||0).toLocaleString()} failed · {Number(c.queuedItems||0).toLocaleString()} queued · {Number(c.processingItems||0).toLocaleString()} processing · {c.processingBatches||0} chunks</small></span><span className={"bulk-history-status "+String(c.status).toLowerCase()}>{c.status.replaceAll("_"," ")}</span></div>):<small>No issuance campaigns yet.</small>}</div><div className="bulk-history-list"><b>Recent processing batches</b>{history.length?history.map(batch=><button type="button" key={batch.id} onClick={()=>setActiveBatchId(batch.id)}><span><b>{batch.fileName}</b><small>{batch.totalItems} records · {batch.createdAt?new Date(batch.createdAt).toLocaleString():""}</small></span><span className={"bulk-history-status "+String(batch.status).toLowerCase()}>{batch.status.replaceAll("_"," ")}</span></button>):<small>No bulk issuance batches yet.</small>}</div>
 {batchStatus&&<div className="bulk-batch-status"><b>Selected batch: {batchStatus.status.replaceAll("_"," ")}</b><small>{batchStatus.issuedItems||0} issued · {batchStatus.failedItems||0} failed · {batchStatus.documentFailedItems||0} document issues · {batchStatus.queuedItems||0} queued · {batchStatus.processingItems||0} processing</small></div>}<ul className="bulk-control-list"><li>Only approved credential issuers can issue.</li><li>Each student is issued through the existing certificate endpoint.</li><li>Student number is the exact matching key for uploaded PDFs.</li><li>Every certificate receives its own verification key and SHA-256 credential digest.</li><li>Documents are uploaded to private storage and fingerprinted.</li><li>Successful issuance and document upload are written to the audit log.</li><li>Failed records are reported separately; VERITY does not silently skip them.</li></ul><div className="bulk-warning"><AlertTriangle size={16}/><span>Document uploads are type-checked and fingerprinted, but VERITY does not perform antivirus scanning.</span></div><div className="bulk-template-info"><b>ZIP safety checks</b><p>Encrypted archives, unsupported compression, non-PDF files, duplicate names, oversized entries, invalid checksums and unsafe archive links are rejected.</p></div></section></div>
 </div>;
}
