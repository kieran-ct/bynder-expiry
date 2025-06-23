const fetch = require('node-fetch');
require('dotenv').config();

const BYNDER_TOKEN = process.env.BYNDER_TOKEN;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const BYNDER_BASE_URL = process.env.BYNDER_BASE_URL || 'https://yourcompany.bynder.com';

const ALERT_WINDOW_DAYS = 7;
const ORGANIC_KEY = 'Organic_expiry_date';
const PAID_KEY = 'Paid_expiry_date';

function isWithinWindow(dateStr) {
  if (!dateStr) return false;
  const now = new Date();
  const expiry = new Date(dateStr);
  const cutoff = new Date(now.getTime() + ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return expiry > now && expiry <= cutoff;
}

async function fetchAssets() {
  const res = await fetch(`${BYNDER_BASE_URL}/api/v4/media/`, {
    headers: { Authorization: `Bearer ${BYNDER_TOKEN}` }
  });

  if (!res.ok) {
    console.error('Error fetching assets:', res.status, await res.text());
    return [];
  }

  return res.json();
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
    console.error('Slack webhook error:', res.status, await res.text());
  }
}

async function runCheck() {
  const assets = await fetchAssets();

  for (const asset of assets) {
    const organicExpiry = asset.metadata?.[ORGANIC_KEY];
    const paidExpiry = asset.metadata?.[PAID_KEY];

    if (isWithinWindow(organicExpiry)) {
      await notifySlack(asset, 'organic', organicExpiry);
    }

    if (isWithinWindow(paidExpiry)) {
      await notifySlack(asset, 'paid', paidExpiry);
    }
  }
}

runCheck().catch(console.error);
