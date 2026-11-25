import ExcelJS from "exceljs";

export async function parseXlsxRoster(file){
 const workbook=new ExcelJS.Workbook();
 await workbook.xlsx.load(await file.arrayBuffer());
 const sheets=workbook.worksheets.filter(sheet=>sheet.state==="visible"&&sheet.rowCount>0);
 if(sheets.length!==1)throw Error("Use exactly one visible, non-empty worksheet per import workbook.");
 const sheet=sheets[0];
 if(sheet.rowCount>50001)throw Error("A single import is limited to 50,000 student rows.");
 const headers=sheet.getRow(1).values.slice(1).map(value=>String(value??"").trim().toLowerCase().replace(/[\\s-]+/g,"_"));
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
