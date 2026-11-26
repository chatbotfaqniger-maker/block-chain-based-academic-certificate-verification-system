import ExcelJS from "exceljs";

function assertSafeXlsxArchive(buffer){
 const bytes=new Uint8Array(buffer),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 let eocd=-1;
 for(let i=Math.max(0,bytes.length-65557);i<=bytes.length-22;i++)if(view.getUint32(i,true)===0x06054b50)eocd=i;
 if(eocd<0)throw Error("The Excel workbook is not a valid XLSX ZIP archive.");
 if(view.getUint16(eocd+4,true)!==0||view.getUint16(eocd+6,true)!==0)throw Error("Multi-disk Excel workbooks are not supported.");
 const count=view.getUint16(eocd+10,true),centralSize=view.getUint32(eocd+12,true),centralOffset=view.getUint32(eocd+16,true);
 if(count===0xffff||centralSize===0xffffffff||centralOffset===0xffffffff)throw Error("ZIP64 Excel workbooks are not supported.");
 if(count>3000||centralOffset+centralSize>bytes.length)throw Error("The workbook contains too many ZIP entries or an invalid directory.");
 let pointer=centralOffset,totalExpanded=0;
 for(let index=0;index<count;index++){
  if(view.getUint32(pointer,true)!==0x02014b50)throw Error("The Excel workbook ZIP directory is malformed.");
  const flags=view.getUint16(pointer+8,true),method=view.getUint16(pointer+10,true),expanded=view.getUint32(pointer+24,true),nameLength=view.getUint16(pointer+28,true),extraLength=view.getUint16(pointer+30,true),commentLength=view.getUint16(pointer+32,true),external=view.getUint32(pointer+38,true),compressed=view.getUint32(pointer+20,true);
  if(flags&1)throw Error("Encrypted Excel workbooks are not supported.");
  if(method!==0&&method!==8)throw Error("The Excel workbook uses unsupported ZIP compression.");
  if(expanded===0xffffffff||compressed===0xffffffff||expanded>20*1024*1024)throw Error("An Excel workbook component exceeds the safe size limit.");
  totalExpanded+=expanded;if(totalExpanded>60*1024*1024)throw Error("The expanded Excel workbook exceeds the 60 MB safety limit.");
  const name=new TextDecoder("utf-8",{fatal:true}).decode(bytes.slice(pointer+46,pointer+46+nameLength));
  if(name.startsWith("/")||name.split(/[\\/]/).includes(".."))throw Error("The Excel workbook contains an unsafe ZIP entry path.");
  if((external>>>16&0xf000)===0xa000)throw Error("Excel workbooks containing symbolic links are not accepted.");
  pointer+=46+nameLength+extraLength+commentLength;
 }
 if(pointer>centralOffset+centralSize)throw Error("The Excel workbook ZIP directory exceeds its declared size.");
}
export async function parseXlsxRoster(file){
 const buffer=await file.arrayBuffer();
 assertSafeXlsxArchive(buffer);
 const workbook=new ExcelJS.Workbook();
 await workbook.xlsx.load(buffer);
 const sheets=workbook.worksheets.filter(sheet=>sheet.state==="visible"&&sheet.rowCount>0);
 if(sheets.length!==1)throw Error("Use exactly one visible, non-empty worksheet per import workbook.");
 const sheet=sheets[0];
 if(sheet.rowCount>50001)throw Error("A single import is limited to 50,000 student rows.");
 if(sheet.columnCount>40)throw Error("The roster worksheet may contain no more than 40 columns.");
 const headers=sheet.getRow(1).values.slice(1).map(value=>String(value??"").trim().toLowerCase().replace(/[\s-]+/g,"_"));
 while(headers.length&&!headers[headers.length-1])headers.pop();
 if(!headers.length||headers.some(header=>!header))throw Error("The first worksheet row must contain non-empty column headers.");
 if(new Set(headers).size!==headers.length)throw Error("The workbook contains duplicate column headers.");
 const required=["student_number","full_name","faculty","department","programme","qualification"];
 const missing=required.filter(key=>!headers.includes(key));
 if(missing.length)throw Error("Missing required columns: "+missing.join(", "));
 const rows=[];
 sheet.eachRow({includeEmpty:false},row=>{
  if(row.number===1)return;
  const values=headers.map((header,index)=>{
   const cell=row.getCell(index+1),value=cell.value;
   if(value===null||value===undefined)return "";
   if(value&&typeof value==="object"){
    if(value.formula||value.sharedFormula)throw Error("Formula cells are not accepted (worksheet row "+row.number+"). Replace formulas with verified values.");
    if(value.error)throw Error("The workbook contains an Excel error value at row "+row.number+".");
    if(Array.isArray(value.richText))return value.richText.map(part=>part.text||"").join("").trim();
    if(value.text!==undefined)return String(value.text).trim();
    if(value.hyperlink)return String(value.text||value.hyperlink).trim();
    if(value instanceof Date)return value.toISOString().slice(0,10);
    throw Error("Unsupported Excel cell content at row "+row.number+".");
   }
   if(value instanceof Date)return value.toISOString().slice(0,10);
   if(header==="award_date"&&typeof value==="number"&&Number.isFinite(value))return new Date(Date.UTC(1899,11,30)+Math.round(value)*86400000).toISOString().slice(0,10);
   if(header==="student_number"&&typeof value==="number")throw Error("Student numbers in Excel must be formatted as Text to preserve leading zeros (row "+row.number+").");
   return String(value).trim();
  });
  if(values.some(value=>value!=="")){
   const x=Object.fromEntries(headers.map((header,index)=>[header,values[index]||""]));
   rows.push({rowNumber:row.number,studentNumber:x.student_number,fullName:x.full_name,email:x.email||"",faculty:x.faculty,department:x.department,programme:x.programme,qualification:x.qualification,classification:x.classification||"",awardDate:x.award_date||null,academicSession:x.academic_session||""});
  }
 });
 if(!rows.length)throw Error("Add at least one student row to the first worksheet.");
 if(rows.length>50000)throw Error("A single import is limited to 50,000 student rows.");
 return rows;
}
