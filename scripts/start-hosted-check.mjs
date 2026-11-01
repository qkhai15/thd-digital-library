import dotenv from "dotenv";
import { spawn } from "node:child_process";
dotenv.config({path:process.env.DB_TARGET_ENV_FILE||".env.local",quiet:true});
if(!process.env.SUPABASE_DATABASE_URL||!process.env.DB_SSL_CA_FILE)throw new Error("Missing hosted connection or CA file.");
const child=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--port",process.env.HOSTED_TEST_PORT||"3102"],{env:{...process.env,DATABASE_URL:process.env.SUPABASE_DATABASE_URL,AUTO_MIGRATE:"false",STORAGE_DRIVER:"supabase"},stdio:"inherit",windowsHide:true});
child.on("close",code=>process.exitCode=code);
