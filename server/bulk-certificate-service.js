import crypto from "node:crypto";

const digest=value=>crypto.createHash("sha256").update(value).digest("hex");
const canonical=c=>JSON.stringify({
  certificateId:c.certificateId,
  studentName:c.studentName.trim(),
  studentNumber:c.studentNumber.trim(),
  institution:c.institution.trim(),
  faculty:c.faculty.trim(),
  department:c.department.trim(),
  programme:c.programme.trim(),
  qualification:c.qualification.trim(),
  classification:c.classification||"",
  awardDate:new Date(c.awardDate).toISOString()
});
const safeFileName=value=>String(value||"certificate.pdf").normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,120)||"certificate.pdf";
const permanent=(message,code="BULK_ISSUANCE_INVALID")=>Object.assign(new Error(message),{permanent:true,code});

export function createBulkCertificateProcessor({client,audit,createVerityNotification,notifyVerityAdmins,logger=console}){
  if(!client?.from||!client?.storage||!client?.rpc)throw new Error("A service-role Supabase client is required");
  async function issueRecord(item,batch,organization){
    const clean=Object.fromEntries(Object.entries(item.payload||{}).map(([key,value])=>[key,typeof value==="string"?value.trim():value]));
    clean.institution=organization.name;
    clean.studentEmail=String(clean.studentEmail||"").trim().toLowerCase()||null;
    if(!clean.studentName||!clean.studentNumber||!clean.faculty||!clean.department||!clean.programme||!clean.qualification||!clean.awardDate){
      throw permanent("The staged certificate payload is incomplete.");
    }
    const certificateId=`VRT-${new Date().getFullYear()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const verificationKey=`VRT-${crypto.randomBytes(16).toString("hex").toUpperCase()}`;
    const hash=digest(canonical({...clean,certificateId}));
    let graduateId=null;
    if(clean.studentEmail){
      const {data:graduate,error}=await client.from("User").select("id").eq("email",clean.studentEmail).maybeSingle();
      if(error)throw error;
      graduateId=graduate?.id||null;
    }
    const now=new Date().toISOString();
    const record={
      ...clean,id:crypto.randomUUID(),studentEmail:clean.studentEmail,certificateId,verificationKey,
      organizationId:organization.id,digest:hash,awardDate:new Date(clean.awardDate).toISOString(),status:"ACTIVE",
      issuerId:batch.createdBy,graduateId,txHash:null,chainId:null,contractAddress:null,
      createdAt:now,updatedAt:now,issuedAt:now,bulkIssuanceItemId:item.id
    };
    // Bulk issuance deliberately uses the authoritative Supabase ledger only.
    // It never sends one Polygon transaction per row or incurs gas fees.
    const {data,error}=await client.from("Certificate").insert(record).select().single();
    if(error){
      if(error.code==="23505"){
        const {data:existing,error:lookupError}=await client.from("Certificate").select("*").eq("bulkIssuanceItemId",item.id).maybeSingle();
        if(lookupError)throw lookupError;
        if(existing)return existing;
      }
      throw error;
    }
    try{await audit(client,batch.createdBy,"CERTIFICATE_ISSUED","Certificate",data.id,{certificateId,mode:"SUPABASE_LEDGER",bulkIssuanceBatchId:batch.id,bulkIssuanceItemId:item.id,organizationId:organization.id});}
    catch(error){logger.error?.("Bulk certificate audit event failed after ledger insertion",{itemId:item.id,error:error?.message||String(error)});}
    if(data.graduateId){
      try{await createVerityNotification(data.graduateId,{type:"CERTIFICATE_ISSUED",category:"CERTIFICATE",title:"A new certificate is available",body:"A certificate from "+organization.name+" has been added to your VERITY account.",url:"/certificates",metadata:{certificateId}});}
      catch(error){logger.error?.("Bulk certificate graduate notification failed",{itemId:item.id,error:error?.message||String(error)});}
    }
    try{await notifyVerityAdmins({type:"CERTIFICATE_ISSUED",category:"PLATFORM",title:"Certificate issued",body:certificateId+" was issued by "+organization.name+".",url:"/certificates",metadata:{certificateId,bulkIssuanceBatchId:batch.id}});}
    catch(error){logger.error?.("Bulk certificate administrator notification failed",{itemId:item.id,error:error?.message||String(error)});}
    return data;
  }

  async function attachDocument(item,batch,organization,certificate){
    const {data:existingDocs,error:existingError}=await client.from("CertificateDocument")
      .select("id,sha256,storagePath").eq("certificateId",certificate.id).order("createdAt",{ascending:false}).limit(1);
    if(existingError)throw existingError;
    if(existingDocs?.length){
      if(existingDocs[0].sha256!==item.documentSha256)throw permanent("A different document is already attached to this certificate.","CERTIFICATE_DOCUMENT_CONFLICT");
      try{await client.storage.from("verity-certificates").remove([item.documentStoragePath]);}catch{}
      return existingDocs[0];
    }
    const {data:file,error:downloadError}=await client.storage.from("verity-certificates").download(item.documentStoragePath);
    if(downloadError)throw downloadError;
    if(!file)throw permanent("The staged certificate PDF is missing.","STAGED_DOCUMENT_MISSING");
    const bytes=Buffer.from(await file.arrayBuffer());
    if(!bytes.length||bytes.length>10*1024*1024||bytes.subarray(0,5).toString("ascii")!=="%PDF-"){
      throw permanent("The staged document is not a valid PDF within the 10 MB limit.","INVALID_STAGED_PDF");
    }
    if(digest(bytes)!==item.documentSha256)throw permanent("The staged PDF SHA-256 fingerprint does not match.","STAGED_DOCUMENT_HASH_MISMATCH");
    const storagePath=`${organization.id}/${certificate.id}/bulk-${item.id}.pdf`;
    const storage=client.storage.from("verity-certificates");
    const {error:uploadError}=await storage.upload(storagePath,bytes,{contentType:"application/pdf",upsert:false,cacheControl:"3600"});
    if(uploadError){
      const {data:existingFile,error:existingFileError}=await storage.download(storagePath);
      if(existingFileError)throw uploadError;
      const existingBytes=Buffer.from(await existingFile.arrayBuffer());
      if(digest(existingBytes)!==item.documentSha256)throw permanent("A conflicting file already exists at the certificate storage path.","CERTIFICATE_STORAGE_CONFLICT");
    }
    const fileId=crypto.randomUUID();
    const metadata={
      id:fileId,certificateId:certificate.id,organizationId:organization.id,storagePath,
      originalName:safeFileName(item.documentName||("certificate-"+certificate.certificateId+".pdf")),
      mimeType:"application/pdf",sizeBytes:bytes.length,sha256:item.documentSha256,
      uploadedBy:batch.createdBy,scanStatus:"NOT_SCANNED"
    };
    const {data:document,error:documentError}=await client.from("CertificateDocument").insert(metadata).select().single();
    if(documentError){
      if(documentError.code==="23505"){
        const {data:existing,error:lookupError}=await client.from("CertificateDocument").select("id,sha256,storagePath").eq("certificateId",certificate.id).order("createdAt",{ascending:false}).limit(1);
        if(lookupError)throw lookupError;
        if(existing?.[0]?.sha256===item.documentSha256)return existing[0];
      }
      throw documentError;
    }
    try{await audit(client,batch.createdBy,"CERTIFICATE_DOCUMENT_UPLOADED","CertificateDocument",document.id,{certificateId:certificate.certificateId,organizationId:organization.id,sha256:item.documentSha256,scanStatus:"NOT_SCANNED",malwareScanning:false,bulkIssuanceBatchId:batch.id});}
    catch(error){logger.error?.("Bulk certificate document audit event failed",{itemId:item.id,error:error?.message||String(error)});}
    try{await storage.remove([item.documentStoragePath]);}
    catch(error){logger.warn?.("Private bulk staging document cleanup will need retry",{itemId:item.id,error:error?.message||String(error)});}
    return document;
  }

  async function processItem(item){
    const [{data:batch,error:batchError},{data:organization,error:orgError}]=await Promise.all([
      client.from("CertificateIssuanceBatch").select("id,organizationId,createdBy,status").eq("id",item.batchId).maybeSingle(),
      client.from("Organization").select("id,name,type,status,ownerId").eq("id",item.organizationId).maybeSingle()
    ]);
    if(batchError)throw batchError;if(orgError)throw orgError;
    if(!batch||!organization||batch.organizationId!==organization.id)throw permanent("Issuance batch or institution was not found.","BULK_BATCH_NOT_FOUND");
    if(organization.type!=="INSTITUTION"||organization.status!=="APPROVED"||organization.ownerId!==batch.createdBy)throw permanent("The issuing institution is no longer approved or the batch owner no longer controls it.","INSTITUTION_NOT_APPROVED");
    let certificate=null;
    if(item.certificateId){
      const {data,error}=await client.from("Certificate").select("*").eq("certificateId",item.certificateId).eq("bulkIssuanceItemId",item.id).maybeSingle();
      if(error)throw error;certificate=data;
    }
    if(!certificate){
      const {data,error}=await client.from("Certificate").select("*").eq("bulkIssuanceItemId",item.id).maybeSingle();
      if(error)throw error;certificate=data;
    }
    if(!certificate)certificate=await issueRecord(item,batch,organization);
    try{
      await attachDocument(item,batch,organization,certificate);
    }catch(error){
      error.certificateId=certificate.certificateId;
      throw error;
    }
    return {status:"ISSUED",certificateId:certificate.certificateId};
  }

  async function reconcilePending(){
    const {data:items,error}=await client.from("CertificateIssuanceItem")
      .select("id,batchId,organizationId,rowNumber,studentNumber,payload,certificateId,documentStoragePath,documentName,documentSha256")
      .eq("status","NEEDS_REVIEW").order("updatedAt",{ascending:true}).limit(20);
    if(error)throw error;
    for(const item of items||[]){
      try{
        const {data:certificate,error:certificateError}=await client.from("Certificate").select("*").eq("bulkIssuanceItemId",item.id).maybeSingle();
        if(certificateError)throw certificateError;
        if(!certificate)continue;
        const [{data:batch,error:batchError},{data:organization,error:orgError}]=await Promise.all([
          client.from("CertificateIssuanceBatch").select("id,organizationId,createdBy").eq("id",item.batchId).maybeSingle(),
          client.from("Organization").select("id,name,type,status,ownerId").eq("id",item.organizationId).maybeSingle()
        ]);
        if(batchError)throw batchError;if(orgError)throw orgError;
        if(!batch||!organization)continue;
        let documentFailed=false,errorMessage=null;
        try{await attachDocument(item,batch,organization,certificate);}
        catch(error){
          if(!error.permanent)continue;
          documentFailed=true;errorMessage=String(error.message||"Document reconciliation failed").slice(0,500);
        }
        const {error:reconcileError}=await client.rpc("reconcile_certificate_issuance_item",{
          p_item_id:item.id,p_document_failed:documentFailed,p_error_message:errorMessage
        });
        if(reconcileError)throw reconcileError;
      }catch(error){
        logger.error?.("Bulk certificate issuance reconciliation failed",{itemId:item.id,error:error?.message||String(error)});
      }
    }
  }

  return {processItem,reconcilePending};
}
