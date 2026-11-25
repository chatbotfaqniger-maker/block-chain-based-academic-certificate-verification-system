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
  const duration = 120;
  const institution = clean(certificate?.institution, "Approved academic institution");
  const qualification = clean(certificate?.qualification, "Academic qualification");
  const certificateId = mask(certificate?.certificateId);
  const verificationKey = mask(certificate?.verificationKey);
  const status = verification?.verified ? "VERIFIED · LIVE REGISTRY CHECK" : clean(verification?.status, "LIVE CHECK NOT AVAILABLE");
  const audit = auditEvents[0] ? clean(String(auditEvents[0].action || "Platform activity").replaceAll("_", " "), "Platform activity") : "Audit events appear here as platform actions occur";
  const chainLabel = chain?.enabled ? "EVM NETWORK CONNECTED" : "DATABASE LEDGER MODE · NO ON-CHAIN CLAIM";
  const scenes = [
    ["VERITY · DIGITAL CREDENTIAL NETWORK","Trust every credential.","A connected platform for issuing, sharing and verifying academic achievements.","THE FUTURE OF DIGITAL CREDENTIAL VERIFICATION","VERITY / INTRO",["Issue with confidence","Share with control","Verify with evidence",""]],
    ["01 / LIVE PLATFORM OVERVIEW","One network. Four workspaces.","Live platform totals and credential activity, loaded from the authenticated VERITY database.","REAL PLATFORM DATA · REFRESHED AT EXPORT","LIVE DASHBOARD",["Total credentials  " + (stats.total ?? 0),"Active credentials  " + (stats.active ?? 0),"Revoked credentials  " + (stats.revoked ?? 0),"Verifications  " + (stats.verifications ?? 0)]],
    ["02 / INSTITUTION WORKSPACE","Start with the official student record.","An approved institution manages its Student Directory and reviews academic information before issuance.","STUDENT IDENTITY · INSTITUTIONAL CONTROL","STUDENT DIRECTORY",[institution,qualification,"Approved issuer","Controlled ICT access"]],
    ["03 / CSV + EXCEL ROSTER IMPORT","Upload is not approval.","CSV and native XLSX files are validated, previewed and staged. No roster record is committed during upload.","VALIDATE · PREVIEW · STAGE","ROSTER IMPORT",["CSV template available","Native XLSX template available","Formula cells rejected","Duplicate numbers detected"]],
    ["04 / MANDATORY OWNER APPROVAL","Only the issuer owner approves.","The Institution or Organization Owner reviews the batch and explicitly approves it. ICT cannot approve its own upload.","OWNER APPROVAL · NO SELF-APPROVAL","IMPORT REVIEW",["Batch status  AWAITING_APPROVAL","Manifest and row totals","Approve or reject","Worker waits for approval"]],
    ["05 / STUDENT DIRECTORY CORRECTIONS","A record change needs evidence.","ICT submits a proposed change with a reason. The current student record stays unchanged until the issuer owner decides.","REQUEST · ORIGINAL SNAPSHOT · REASON","CORRECTION REQUEST",["Original values preserved","Proposed values shown","Reason required","Pending owner review"]],
    ["06 / OWNER DECISION","Review before applying changes.","The Institution or Organization Owner compares the original and proposed values, then approves or rejects. Stale records require a new request.","OWNER-ONLY DECISION · AUDIT HISTORY","CORRECTION REVIEW",["Compare before and after","Approve or reject","Detect stale snapshots","Record the decision"]],
    ["07 / CERTIFICATE ISSUANCE","Issued means locked forever.","Each certificate receives its own identity and SHA-256 fingerprint. Its academic contents and original document cannot be edited.","CERTIFICATE ID · VERIFICATION KEY · SHA-256","IMMUTABLE ISSUANCE",["Certificate ID  " + certificateId,"Verification key  " + verificationKey,"Fingerprint  " + clean(certificate?.digest ? String(certificate.digest).slice(0,18)+"…" : "", "Created at issuance"),"Content locked permanently"]],
    ["08 / GRADUATE WORKSPACE","The achievement belongs to the graduate.","Graduates claim an approved roster record through VERITY's existing identity verification workflow and access their credentials.","APPROVED ROSTER · STUDENT IDENTITY","MY CREDENTIALS",[qualification,institution,"Credential status  "+clean(certificate?.status,"—"),"Account claim is verified"]],
    ["09 / SECURE SHARING","Share proof. Protect the original.","Graduates share a verification link or key. Access to private original documents remains subject to graduate consent.","VERIFICATION LINK · CONSENT-BASED ACCESS","SHARE CREDENTIAL",["Verification reference  "+verificationKey,"Public status check  Available","Original document  Consent required","Private access  Time-limited"]],
    ["10 / ORGANIZATION WORKSPACE","Verify against the issuer's record.","Organizations check issuer identity, credential status and integrity before making a decision.","APPROVED ISSUER · REGISTRY RESPONSE","ORGANIZATION VERIFICATION",["Submitted reference  "+verificationKey,"Registry response  "+status,"Credential  "+qualification,"Issuer  "+institution]],
    ["11 / ADMINISTRATION","Oversight at every step.","Administrators oversee organization approvals, system health and audit activity while the certificate ledger preserves append-only issuance history.","SUPABASE SOURCE OF TRUTH · AUDIT · SYSTEM HEALTH","ADMIN CONTROL CENTRE",["Credential records  "+(stats.total??0),"Verification activity  "+(stats.verifications??0),"Latest audit event  "+audit,"Ledger  Append-only SHA-256","Network status  "+chainLabel]],
    ["12 / CREDENTIAL CORRECTION REQUEST","A certificate correction is separate.","A request references the original certificate ID and digest, with proposed corrected values and supporting reason. The original remains unchanged.","ORIGINAL ID · ORIGINAL DIGEST · EVIDENCE","CORRECTION REQUEST",["Select the issued certificate","Record proposed values","Provide the reason","Submit for owner review"]],
    ["13 / OWNER AUTHORIZATION","Approval never edits the original.","The issuer owner authorizes a separate new issuance. The original is revoked with a documented reason through its own lifecycle event.","OWNER AUTHORIZATION · AUDITED REVOCATION","REISSUANCE APPROVAL",["Approve or reject request","Original content stays locked","Revoke with a reason","Preserve historical record"]],
    ["14 / REPLACEMENT + VERIFICATION","A new credential. The same history.","Issue a new certificate with a new ID and fingerprint, link it only after validation, and verify both records through their audit history.","NEW CERTIFICATE ID · ORIGINAL PRESERVED","VERIFY THE RESULT",["Replacement values checked","New ID and fingerprint","Original remains unchanged","Auditable verification history"]]
  ];

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
      "[bass][lowpad][midpad][highpad][shimmer][air]amix=inputs=6:duration=longest:normalize=0,afade=t=in:st=0:d=4,afade=t=out:st=114:d=6,alimiter=limit=0.88[aout]",
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
