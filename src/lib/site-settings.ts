import { db, ensureSchema } from "./db";
import {discoverySettings} from './discovery-policy';

export async function homepageDiscovery(){
  await ensureSchema();
  const result=await db.query("SELECT value FROM site_settings WHERE key='homepage_discovery'");
  return discoverySettings(result.rows[0]?.value);
}

export async function commentsRequireApproval() {
  await ensureSchema();
  const result = await db.query(`SELECT value FROM site_settings WHERE key='comments_require_approval'`);
  return typeof result.rows[0]?.value === "boolean" ? result.rows[0].value : process.env.COMMENTS_REQUIRE_APPROVAL === "true";
}
