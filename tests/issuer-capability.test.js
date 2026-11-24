import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const foundation=read("../supabase/migrations/20261124150000_organization_capabilities_and_school_levels.sql");
const workflows=read("../supabase/migrations/20261124153000_enable_capability_based_issuer_workflows.sql");
const server=read("../server/index.js");
const app=read("../src/App.jsx");
const bulk=read("../src/BulkCertificates.jsx");
const studio=read("../src/CertificateDesignStudio.jsx");

test("one school organization can serve primary and secondary education",()=>{
 assert.ok(foundation.includes('"educationLevels" text[] NOT NULL DEFAULT ARRAY[]::text[]'));
 assert.ok(foundation.includes("ARRAY['PRIMARY','SECONDARY','TERTIARY']"));
 assert.ok(server.includes('const educationLevels=organizationType==="INSTITUTION"'));
 assert.ok(app.includes('form.educationLevels.includes("PRIMARY")'));
 assert.ok(app.includes('form.educationLevels.includes("SECONDARY")'));
 assert.ok(app.includes('required={form.educationLevels.includes("TERTIARY")}'));
 assert.ok(server.includes("requiresTertiaryEvidence=org.type==="));
});

test("legacy organization categories keep only their existing baseline permission",()=>{
 assert.ok(foundation.includes("CASE WHEN o.type = 'INSTITUTION' THEN 'ISSUE_CREDENTIALS' ELSE 'VERIFY_CREDENTIALS' END"));
 assert.ok(foundation.includes("Existing organization capability preserved during additive VERITY expansion."));
 assert.ok(foundation.includes('UNIQUE ("organizationId", capability)'));
 assert.ok(foundation.includes("o.status = 'APPROVED'"));
 assert.ok(foundation.includes("c.status = 'APPROVED'"));
});

test("issuer and verifier capabilities are enforced independently by server and database",()=>{
 assert.ok(server.includes('hasApprovedOrganizationCapability(q.supabase,organization.id,"ISSUE_CREDENTIALS")'));
 assert.ok(server.includes('hasApprovedOrganizationCapability(q.supabase,org.id,"VERIFY_CREDENTIALS")'));
 assert.ok(server.includes("async function bulkInstitutionFor"));
 assert.ok(workflows.includes("verity_certificate_admin_insert"));
 assert.ok(workflows.includes("verity_certificate_grant_insert_org"));
 assert.ok(workflows.includes("private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')"));
 assert.ok(workflows.includes("private.verity_organization_has_capability(o.id,'VERIFY_CREDENTIALS')"));
});

test("private student roster precheck is service-role-only",()=>{
 assert.ok(workflows.includes("REVOKE ALL ON FUNCTION public.verity_student_registration_precheck(text,text)"));
 assert.ok(workflows.includes("FROM PUBLIC, anon, authenticated"));
 assert.ok(workflows.includes("GRANT EXECUTE ON FUNCTION public.verity_student_registration_precheck(text,text)"));
 assert.ok(workflows.includes("TO service_role"));
 assert.ok(workflows.includes("GRANT EXECUTE ON FUNCTION public.verity_student_signup_institutions()"));
 assert.ok(workflows.includes("TO anon, authenticated, service_role"));
 assert.ok(workflows.includes("GRANT EXECUTE ON FUNCTION public.lookup_verity_certificate_for_org(text)"));
 assert.ok(server.includes('const server=makeServerClient();const {data:issuers,error}=await server.rpc("verity_student_signup_institutions")'));
});

test("the existing certificate template studio and bulk methods remain in place",()=>{
 for(const method of ["CSV_ZIP","CSV_MULTIPLE_PDFS","CSV_GENERATED"])assert.ok(bulk.includes(method));
 assert.ok(bulk.includes("rows.length>501"));
 assert.ok(server.includes("totalItems:z.number().int().min(1).max(500)"));
 assert.ok(studio.includes('request("/organization/certificate-design/templates")'));
 assert.ok(studio.includes("Upload your approved PDF or high-resolution PNG/JPEG artwork"));
 assert.ok(studio.includes("fieldLayout"));
 assert.ok(!workflows.includes('DROP TABLE public."InstitutionCertificateTemplate"'));
 assert.ok(workflows.includes("CertificateIssuanceBatch"));
 assert.ok(workflows.includes("CertificateIssuanceItem"));
});
