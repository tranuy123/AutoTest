// Kiem tra tinh dung dan cua docker-compose.yml bang cach phan tich YAML that.
// Dung khi moi truong khong co Docker (vi du Muse VM): kiem tra cau truc,
// khong thay the buoc `docker compose up` tren may that.
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const raw = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
const doc = parse(raw);

const errors = [];
const services = doc?.services ?? {};
const expected = ["control", "orchestrator", "runner", "db"];

for (const name of expected) {
  if (!services[name]) {
    errors.push(`Thieu service: ${name}`);
    continue;
  }
  if (!services[name].healthcheck) errors.push(`Service ${name} thieu healthcheck`);
}

const portsOf = (svc) => (services[svc]?.ports ?? []).map(String);
if (!portsOf("control").some((p) => p.includes("3100"))) errors.push("control chua map cong 3100");
if (!portsOf("orchestrator").some((p) => p.includes("3101")))
  errors.push("orchestrator chua map cong 3101");
if (portsOf("db").length > 0) errors.push("db khong duoc publish cong ra ngoai (S1.1)");
if (!doc?.volumes || !("db_data" in doc.volumes)) errors.push("Thieu volume db_data cho db");

if (errors.length > 0) {
  console.error("docker-compose.yml KHONG dat:\n- " + errors.join("\n- "));
  process.exit(1);
}
console.log(
  "docker-compose.yml dat kiem tra cau truc: 4 service (control, orchestrator, runner, db), du healthcheck, cong 3100/3101, db khong publish cong, co volume db_data."
);
