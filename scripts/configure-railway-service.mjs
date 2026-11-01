import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

// Service settings, not retired railway.toml Config-as-Code. No database or secrets.
const ids = Object.fromEntries(["PROJECT", "SERVICE", "ENVIRONMENT"].map(key => {
  const name = `RAILWAY_${key}_ID`, value = process.env[name];
  if (!value || !/^[a-f0-9-]{36}$/i.test(value)) throw new Error(`Missing/invalid ${name}.`);
  return [key.toLowerCase() + "Id", value];
}));
const config = JSON.parse(await readFile("deploy/railway-service.json", "utf8"));
if (!process.argv.includes("--apply")) {
  console.log(JSON.stringify({mode:"preview",...ids,settings:config,limits:{memoryGB:1,vCPUs:1}}));
} else {
  const cli = process.env.RAILWAY_CLI_BIN || "railway";
  function command(args, input) {
    return new Promise((resolve,reject) => {
      const child = spawn(cli, args, {windowsHide:true,stdio:["pipe","pipe","pipe"]});
      let output = "";
      child.stdout.on("data", bytes => output += bytes);
      child.stderr.on("data", () => undefined);
      child.on("error", () => reject(new Error("Railway CLI unavailable.")));
      child.on("close", code => {
        try {
          const result = JSON.parse(output);
          if (code !== 0 || result.errors) throw new Error();
          resolve(result);
        } catch { reject(new Error("Railway operation failed; credential details suppressed.")); }
      });
      child.stdin.end(input || "");
    });
  }
  const api = async (query, variables) => (await command(["api",query,"--variables","@-","--compact"], JSON.stringify(variables))).data;
  const project = await api("query($id:String!){ project(id:$id){ services{edges{node{id}}} environments{edges{node{id}}} } }", {id:ids.projectId});
  if (!project.project.services.edges.some(edge => edge.node.id === ids.serviceId) || !project.project.environments.edges.some(edge => edge.node.id === ids.environmentId)) throw new Error("Target service/environment does not belong to the project.");
  const updated = await api("mutation($serviceId:String!,$environmentId:String!,$input:ServiceInstanceUpdateInput!){serviceInstanceUpdate(serviceId:$serviceId,environmentId:$environmentId,input:$input)}", {...ids,input:config});
  if (!updated.serviceInstanceUpdate) throw new Error("Service configuration was not applied.");
  const limits = await api("mutation($input:ServiceInstanceLimitsUpdateInput!){serviceInstanceLimitsUpdate(input:$input)}", {input:{serviceId:ids.serviceId,environmentId:ids.environmentId,memoryGB:1,vCPUs:1}});
  if (!limits.serviceInstanceLimitsUpdate) throw new Error("Resource limits were not applied.");
  const actual = await api("query($serviceId:String!,$environmentId:String!){serviceInstance(serviceId:$serviceId,environmentId:$environmentId){dockerfilePath startCommand healthcheckPath healthcheckTimeout restartPolicyType restartPolicyMaxRetries railwayConfigFile} serviceInstanceLimits(serviceId:$serviceId,environmentId:$environmentId)}", ids);
  // Region placement is stored in environment config; the legacy region field
  // stays null and multiRegionConfig is not a ServiceInstance GraphQL field.
  // Do not print this response: it can also contain secret variable values.
  const environment = await api("query($id:String!){environment(id:$id){projectId config(decryptVariables:false)}}", {id:ids.environmentId});
  if (environment.environment.projectId !== ids.projectId) throw new Error("Environment project verification failed.");
  const regions = environment.environment.config.services[ids.serviceId].deploy.multiRegionConfig;
  for (const [key,value] of Object.entries(config)) {
    const observed = key === "multiRegionConfig" ? regions : actual.serviceInstance[key];
    if (JSON.stringify(observed) !== JSON.stringify(value)) throw new Error(`Service setting verification failed: ${key}.`);
  }
  const containers = actual.serviceInstanceLimits.containers;
  if (containers.cpu !== 1 || containers.memoryBytes !== 1_000_000_000) throw new Error("Replica resource verification failed.");
  console.log(JSON.stringify({configured:true,...ids,memoryGB:1,vCPUs:1,regions:Object.keys(config.multiRegionConfig)}));
}
