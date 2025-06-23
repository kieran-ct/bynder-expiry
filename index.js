const fetch = require('node-fetch');
require('dotenv').config();

const BYNDER_TOKEN = process.env.BYNDER_TOKEN;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const BYNDER_BASE_URL = process.env.BYNDER_BASE_URL;

const ALERT_WINDOW_DAYS = 7;

// Metadata IDs for expiry fields
const ORGANIC_EXPIRY_ID = '6375B2CD-C349-434D-8581770837D6214E';
const PAID_EXPIRY_ID = '6C7C1AA3-17CC-41A3-9BA92788E9323FB9';

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

    const data = await res.json();
    all = all.concat(data);

    console.log(`📦 Page ${page}: fetched ${data.length} assets`);
    if (data.length < perPage) break;

    page++;
  }

  console.log(`✅ Total assets fetched: ${all.length}`);
  return all;
}

async function notifySlack(asset, type, expiryDate) {
  const assetName = asset.mediaName || asset.originalFilename || asset.id;
  const assetUrl = `${BYNDER_BASE_URL}/media/${asset.id}`;

  const message = {
    text: `:warning: *${assetName}* has a *${type} expiry* on *${expiryDate}*.\n<${assetUrl}|View asset>`
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

function getExpiryFromMetadata(metadata, targetId) {
  if (!metadata) return null;

  for (const [key, value] of Object.entries(metadata)) {
    if (value?.id === targetId) {
      return value.value;
    }
  }

  return null;
}

async function runCheck() {
  const assets = await fetchAllAssets();
  console.log(`✅ Fetched ${assets.length} assets from Bynder`);

  let notificationsSent = 0;

  for (const asset of assets) {
    const metadata = asset.metadata;
    const name = asset.mediaName || asset.originalFilename || asset.id;

    const organicExpiry = getExpiryFromMetadata(metadata, ORGANIC_EXPIRY_ID);
    const paidExpiry = getExpiryFromMetadata(metadata, PAID_EXPIRY_ID);

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
