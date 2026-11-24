import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const foundation=read("./fixtures/../../supabase/migrations/20261124150000_organization_capabilities_and_school_levels.sql");
const workflows=read("./fixtures/../../supabase/migrations/20261124153000_enable_capability_based_issuer_workflows.sql");
const server=read("../server/index.js");
const app=read("../src/App.jsx");
const bulk=read("../src/BulkCertificates.jsx");
const studio=read("../src/CertificateDesignStudio.jsx");

test("school education levels support one primary-and-secondary organization",()=>{
 assert.match(foundation,/"educationLevels" text\[\] NOT NULL DEFAULT ARRAY\[\]\:\:text\[\]/);
 assert.match(foundation,/ARRAY\['PRIMARY','SECONDARY','TERTIARY'\]/);
 assert.match(server,/educationLevels=organizationType==="INSTITUTION"/);
 assert.match(app,/value="PRIMARY"/);
 assert.match(app,/value="SECONDARY"/);
});

test("existing organization categories retain only their legacy baseline capability",()=>{
 assert.match(foundation,/CASE WHEN o\.type = 'INSTITUTION' THEN 'ISSUE_CREDENTIALS' ELSE 'VERIFY_CREDENTIALS' END/);
 assert.match(foundation,/Existing organization capability preserved during additive VERITY expansion/);
 assert.match(foundation,/UNIQUE \("organizationId", capability\)/);
 assert.match(foundation,/o\.status = 'APPROVED'/);
 assert.match(foundation,/c\.status = 'APPROVED'/);
});

test("issuer and verifier permissions are checked independently in backend workflows",()=>{
 assert.match(server,/hasApprovedOrganizationCapability\(q\.supabase,organization\.id,"ISSUE_CREDENTIALS"\)/);
 assert.match(server,/hasApprovedOrganizationCapability\(q\.supabase,org\.id,"VERIFY_CREDENTIALS"\)/);
 assert.match(server,/async function bulkInstitutionFor/);
 assert.match(server,/hasApprovedOrganizationCapability\(q\.supabase,org\.id,"ISSUE_CREDENTIALS"\)/);
 assert.match(workflows,/verity_certificate_grant_insert_org[\s\S]*?VERIFY_CREDENTIALS/);
 assert.match(workflows,/verity_certificate_admin_insert[\s\S]*?ISSUE_CREDENTIALS/);
});

test("private roster precheck is service-role-only while signup options remain public",()=>{
 assert.match(workflows,/REVOKE ALL ON FUNCTION public\.verity_student_registration_precheck\(text,text\)[\s\S]*?FROM PUBLIC, anon, authenticated/);
 assert.match(workflows,/GRANT EXECUTE ON FUNCTION public\.verity_student_registration_precheck\(text,text\)[\s\S]*?TO service_role/);
 assert.match(workflows,/GRANT EXECUTE ON FUNCTION public\.verity_student_signup_institutions\(\)[\s\S]*?TO anon, authenticated, service_role/);
 assert.match(workflows,/GRANT EXECUTE ON FUNCTION public\.lookup_verity_certificate_for_org\(text\)[\s\S]*?TO authenticated, service_role/);
 assert.match(server,/const server=makeServerClient\(\);const \{data:issuers,error\}=await server\.rpc\("verity_student_signup_institutions"\)/);
});

test("the existing certificate template and bucket-driven bulk methods remain the only issuance pipeline",()=>{
 assert.match(bulk,/CSV_ZIP/);
 assert.match(bulk,/CSV_MULTIPLE_PDFS/);
 assert.match(bulk,/CSV_GENERATED/);
 assert.match(bulk,/max\(1,Math\.min\(500/);
 assert.match(studio,/request\\("\\/organization\\/certificate-design\\/templates"\\)/);
 assert.match(studio,/Upload your approved PDF or high-resolution PNG\\/JPEG artwork/);
 assert.match(studio,/fieldLayout/);
 assert.doesNotMatch(workflows,/DROP TABLE public\\.\\"InstitutionCertificateTemplate\\"/);
 assert.match(workflows,/CertificateIssuanceBatch/);
 assert.match(workflows,/CertificateIssuanceItem/);
});
