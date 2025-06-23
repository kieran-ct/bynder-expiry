const fetch = require('node-fetch');
require('dotenv').config();

const BYNDER_TOKEN = process.env.BYNDER_TOKEN;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const BYNDER_BASE_URL = process.env.BYNDER_BASE_URL;
const ALERT_WINDOW_DAYS = 7;

function isWithinWindow(dateStr, label = '') {
  if (!dateStr) {
    console.log(`⛔️ ${label} expiry is missing or empty`);
    return false;
  }

  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) {
    console.log(`⛔️ ${label} expiry "${dateStr}" could not be parsed as a valid date`);
    return false;
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() + ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const isWithin = parsed > now && parsed <= cutoff;
  console.log(`📅 ${label} expiry "${dateStr}" → ${parsed.toISOString()} | within window: ${isWithin}`);

  return isWithin;
}

console.log(`🚀 Starting expiry check at ${new Date().toISOString()}`);

async function fetchAllAssets() {
  const perPage = 100;
  let page = 1;
  let all = [];

  while (true) {
    const res = await fetch(`${BYNDER_BASE_URL}/api/v4/media/?page=${page}&limit=${perPage}`, {
      headers: { Authorization: `Bearer ${BYNDER_TOKEN}` }
    });

    if (!res.ok) {
      console.error(`❌ Error on page ${page}:`, res.status, await res.text());
      break;
    }

    const pageAssets = await res.json();

    for (const asset of pageAssets) {
      const detailRes = await fetch(`${BYNDER_BASE_URL}/api/v4/media/${asset.id}/`, {
        headers: { Authorization: `Bearer ${BYNDER_TOKEN}` }
      });

      if (!detailRes.ok) {
        console.warn(`⚠️ Could not fetch metadata for asset ${asset.id}:`, detailRes.status);
        continue;
      }

      const fullAsset = await detailRes.json();
      all.push(fullAsset);
    }

    console.log(`📦 Page ${page}: processed ${pageAssets.length} assets`);
    if (pageAssets.length < perPage) break;

    page++;
  }

  console.log(`✅ Total fully loaded assets: ${all.length}`);
  return all;
}

async function notifySlack(asset, type, expiryDate) {
  const assetName = asset.mediaName || asset.originalFilename || asset.name || asset.id;
  const assetUrl = `${BYNDER_BASE_URL}/media/${asset.id}`;

  const message = {
    text: `:warning: *${assetName}* is expiring soon!\n• *Type:* ${type}\n• *Expiry:* ${expiryDate}\n<${assetUrl}|View asset>`
  };

  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message)
  });

  if (!res.ok) {
    console.error('❌ Slack webhook error:', res.status, await res.text());
  }
}

async function runCheck() {
  const assets = await fetchAllAssets();
  console.log(`✅ Fetched ${assets.length} assets from Bynder`);

  if (assets.length === 0) {
    console.log("⚠️ No assets to review.");
    return;
  }

  let notificationsSent = 0;

  for (const asset of assets) {
    const name = asset.mediaName || asset.originalFilename || asset.id;

    const organicExpiry = asset.property_Organic_expiry_date;
    const paidExpiry = asset.property_Paid_expiry_date;

    if (isWithinWindow(organicExpiry, 'Organic')) {
      console.log(`📢 Organic expiry found for "${name}" on ${organicExpiry}`);
      await notifySlack(asset, 'organic', organicExpiry);
      notificationsSent++;
    }

    if (isWithinWindow(paidExpiry, 'Paid')) {
      console.log(`📢 Paid expiry found for "${name}" on ${paidExpiry}`);
      await notifySlack(asset, 'paid', paidExpiry);
      notificationsSent++;
    }
  }

  if (notificationsSent === 0) {
    console.log(`✅ No expiring assets found in the next ${ALERT_WINDOW_DAYS} days.`);
  } else {
    console.log(`✅ Sent ${notificationsSent} Slack notifications.`);
  }
}

runCheck().catch(console.error);
console.log(`✅ Expiry check complete at ${new Date().toISOString()}`);
