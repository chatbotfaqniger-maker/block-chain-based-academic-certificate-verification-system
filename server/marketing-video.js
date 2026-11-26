import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const clean = (value, fallback = "—", max = 78) => {
  const text = String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/[^\p{L}\p{N} .,:;()/_+&-•→·]/gu, "").trim();
  return (text || fallback).slice(0, max);
};
const mask = value => {
  const text = String(value || "");
  if (text.length < 12) return text ? text.slice(0, 4) + "••••" : "Reference unavailable";
  return text.slice(0, 8) + "••••••••" + text.slice(-4);
};
function run(args) {
  return new Promise((resolve, reject) => {
    const process = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    process.stderr.on("data", chunk => error += chunk.toString());
    process.on("error", reject);
    process.on("close", code => code === 0 ? resolve() : reject(new Error(error.slice(-3000) || "MP4 rendering failed.")));
  });
}

export async function createVerityMarketingMp4({ stats = {}, certificate = null, auditEvents = [], chain = {}, verification = null } = {}) {
  const duration = 75;
  const institution = clean(certificate?.institution, "Approved academic institution");
  const qualification = clean(certificate?.qualification, "Academic qualification");
  const certificateId = mask(certificate?.certificateId);
  const verificationKey = mask(certificate?.verificationKey);
  const status = verification?.verified ? "VERIFIED · LIVE REGISTRY CHECK" : clean(verification?.status, "LIVE CHECK NOT AVAILABLE");
  const audit = auditEvents[0] ? clean(String(auditEvents[0].action || "Platform activity").replaceAll("_", " "), "Platform activity") : "Audit events appear here as platform actions occur";
  const chainLabel = chain?.enabled ? "EVM NETWORK CONNECTED" : "DATABASE LEDGER MODE · NO ON-CHAIN CLAIM";
  const scenes = [
    ["01 / INSTITUTION WORKSPACE","Start with the official student record.","An approved institution opens the Student Directory and reviews student identity and academic details before issuing credentials.","STUDENT DIRECTORY · OFFICIAL RECORD","INSTITUTION WORKSPACE",[institution,qualification,"Student identity  Reviewed","Issuance  Controlled"]],
    ["02 / CSV + XLSX TEMPLATE","Use the official import template.","Download the CSV or native Excel template and prepare the institution's verified roster data.","CSV + XLSX · STANDARDIZED COLUMNS","DOWNLOAD TEMPLATE",["CSV template  Available","Excel template  Available","Student number  Text format","One worksheet per workbook"]],
    ["03 / ROSTER VALIDATION","Validate before staging.","Select CSV or native XLSX. VERITY checks required fields, dates, duplicate student numbers and workbook safety before accepting the preview.","VALIDATE · PREVIEW · CHECK DUPLICATES","IMPORT VALIDATION",["Required fields  Checked","Dates  Validated","Duplicate numbers  Detected","Formula cells  Rejected"]],
    ["04 / STAGED IMPORT","Upload is not approval.","The validated roster is staged in a durable batch. No Student Directory rows are committed and no student accounts are linked yet.","STAGED · AWAITING SUBMISSION","IMPORT BATCH",["Batch status  UPLOADING","Rows  "+(stats.total??"Previewed"),"Chunked processing  Ready","No student account linked"]],
    ["05 / ICT SUBMISSION","ICT submits. ICT does not approve.","Institution ICT reviews the completed batch and submits it to the issuer owner for an independent decision.","ICT SUBMISSION · OWNER REVIEW REQUIRED","SUBMIT FOR APPROVAL",["Uploader  Institution ICT","Batch status  AWAITING_APPROVAL","Reason and manifest  Recorded","Self-approval  Blocked"]],
    ["06 / OWNER REVIEW","The issuer owner reviews the batch.","The Institution or Organization Owner checks the manifest, row totals, validation results and import history before deciding.","ISSUER OWNER · BATCH REVIEW","OWNER REVIEW",["Rows and duplicates","Validation summary","Uploader identity","Approval or rejection"]],
    ["07 / OWNER APPROVAL","Only the issuer owner can approve.","The owner explicitly approves or rejects the batch. Until approval, the worker cannot process it.","MANDATORY OWNER APPROVAL","APPROVE IMPORT",["Owner decision  Required","ICT self-approval  Denied","Approved batch  QUEUED","Decision  Audited"]],
    ["08 / SAFE PROCESSING","Commit only after approval.","After approval, the worker processes the staged chunks, skips existing student-number matches and records the result.","APPROVED · PROCESSING · AUDIT","IMPORT RESULTS",["Inserted  "+(stats.active??"Validated rows"),"Duplicates  Skipped","Existing rows  Never overwritten","Claim workflow  Still verified"]],
    ["09 / STUDENT DIRECTORY","Find the correct student record.","Search the Student Directory and compare the official record before proposing any correction.","SEARCH · REVIEW · VERIFY","STUDENT DIRECTORY",[institution,"Student identity  Verified","Record status  Eligible","Official evidence  Required"]],
    ["10 / STUDENT RECORD CORRECTION","A record change needs a reason.","ICT submits proposed values and a reason. The live Student Directory record remains unchanged while the request is pending.","REQUEST · ORIGINAL SNAPSHOT · REASON","CORRECTION REQUEST",["Original values  Preserved","Proposed values  Reviewed","Reason  Required","Status  PENDING"]],
    ["11 / OWNER DECISION","The issuer owner decides.","The Institution or Organization Owner compares original and proposed values, then approves or rejects. Stale snapshots must be resubmitted.","OWNER-ONLY DECISION · AUDIT HISTORY","CORRECTION REVIEW",["Compare before and after","Approve or reject","Stale request  CONFLICT","Decision  Audited"]],
    ["12 / IMMUTABLE CERTIFICATE","Issued means locked forever.","The certificate's academic contents, ID, verification key, original document and SHA-256 fingerprint cannot be edited or deleted.","NO EDIT · NO OVERWRITE · NO DELETE","ISSUED CERTIFICATE",[ "Certificate ID  "+certificateId,"Verification key  "+verificationKey,"Fingerprint  "+clean(certificate?.digest ? String(certificate.digest).slice(0,18)+"…" : "", "Created at issuance"),"Content  Permanently locked"]],
    ["13 / CREDENTIAL CORRECTION","A certificate correction is separate.","Submit a request against the original certificate ID and digest, with proposed corrected values and a documented reason.","ORIGINAL ID · ORIGINAL DIGEST · EVIDENCE","CREDENTIAL CORRECTION",["Select issued certificate","Proposed values","Reason and evidence","Owner review"]],
    ["14 / NEW ISSUANCE","Approval authorizes a new certificate.","The issuer owner approves a separate reissuance. The original certificate is revoked with a documented reason and its contents remain unchanged.","OWNER AUTHORIZATION · SEPARATE REISSUANCE","REISSUE CREDENTIAL",["Original content  Locked","Revocation reason  Recorded","New certificate  Issued separately","New ID and fingerprint"]],
    ["15 / VERIFICATION + AUDIT","Verify both records with confidence.","The replacement is linked only after its corrected values are checked. The original remains in the audit history with its revoked status.","ORIGINAL PRESERVED · REPLACEMENT VERIFIED","FINAL VERIFICATION",["Original  "+clean(verification?.status,"REVOKED / HISTORICAL"),"Replacement  New certificate ID","Ledger  "+audit,"Verification  "+status]]
  ];
  if (scenes.length !== 15 || duration / scenes.length !== 5) throw new Error("VERITY guide export must contain exactly 15 five-second clips.");

  const dir = await mkdtemp(path.join(os.tmpdir(), "verity-marketing-"));
  try {
    const filters = [
      "drawbox=x='mod(t*110,1500)-220':y=0:w=220:h=720:color=0x20b9aa@0.08:t=fill",
      "drawbox=x=690:y=104:w=520:h=520:color=0x102b38@0.96:t=fill",
      "drawbox=x=690:y=104:w=520:h=520:color=0x31515d@0.95:t=2",
      "drawbox=x=690:y=104:w=520:h=48:color=0x173744@1:t=fill",
      "drawbox=x=72:y=650:w=1136:h=2:color=0x31515d@1:t=fill",
      "drawtext=fontfile=/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf:text='VERITY':fontcolor=white:fontsize=30:x=115:y=55",
      "drawtext=fontfile=/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf:text='THE FUTURE OF DIGITAL CREDENTIAL VERIFICATION':fontcolor=0x75939b:fontsize=14:x=72:y=680"
    ];
    for (let i = 0; i < scenes.length; i++) {
      const start = i * duration / scenes.length;
      const end = (i + 1) * duration / scenes.length;
      const files = [];
      const textValues = [...scenes[i].slice(0, 5), ...scenes[i][5]];
      for (let j = 0; j < textValues.length; j++) {
        const file = path.join(dir, "scene-" + i + "-" + j + ".txt");
        await writeFile(file, clean(textValues[j] || "", " ", 112), "utf8");
        files.push(file);
      }
      const add = (file, size, color, x, y) => filters.push(
        "drawtext=fontfile=/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf:textfile=" + file +
        ":expansion=none:fontcolor=" + color + ":fontsize=" + size + ":x=" + x + ":y=" + y +
        ":enable='between(t," + start + "," + end + ")':alpha='if(lt(t," + (start + 0.55) + "),(t-" + start + ")/0.55,if(gt(t," + (end - 0.55) + "),(" + end + "-t)/0.55,1))'"
      );
      add(files[0], 16, "0x69daca", 72, 190);
      add(files[1], 46, "white", 72, 252);
      add(files[2], 21, "0xb5cbd0", 72, 330);
      add(files[3], 14, "0x82aeb6", 72, 414);
      add(files[4], 15, "0x9dded5", 724, 174);
      for (let j = 0; j < scenes[i][5].length; j++) add(files[5 + j], 15, "white", 724, 214 + j * 70);
      filters.push("drawtext=fontfile=/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf:text='" + String(i + 1).padStart(2, "0") + " / 15':fontcolor=0x75939b:fontsize=14:x=1140:y=680:enable='between(t," + start + "," + end + ")'");
    }

    const output = path.join(dir, "VERITY-Marketing-Showcase.mp4");
    const args = ["-y", "-f", "lavfi", "-i", "color=c=0x071722:s=1280x720:r=30:d=" + duration];
    for (const frequency of [55, 110, 164.81, 220, 329.63, 440]) {
      args.push("-f", "lavfi", "-t", String(duration), "-i", "sine=frequency=" + frequency + ":sample_rate=44100");
    }
    args.push(
      "-filter_complex",
      "[1:a]volume=0.16,lowpass=f=180[bass];" +
      "[2:a]volume=0.075,lowpass=f=500[lowpad];" +
      "[3:a]volume=0.065,lowpass=f=700[midpad];" +
      "[4:a]volume=0.055,lowpass=f=1100[highpad];" +
      "[5:a]volume=0.028,lowpass=f=1800[shimmer];" +
      "[6:a]volume=0.018,highpass=f=1800,lowpass=f=6500[air];" +
      "[bass][lowpad][midpad][highpad][shimmer][air]amix=inputs=6:duration=longest:normalize=0,afade=t=in:st=0:d=4,afade=t=out:st=69:d=6,alimiter=limit=0.88[aout]",
      "-map", "0:v", "-map", "[aout]", "-vf", filters.join(","), "-t", String(duration), "-r", "30",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-movflags", "+faststart", output
    );
    await run(args);
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
