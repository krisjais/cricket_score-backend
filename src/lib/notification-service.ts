import * as webpush from 'web-push'

const webPushClient = webpush
import {
  TeamAnnouncement,
  InAppNotification,
  NotificationPreferences,
  NotificationDeliveryJob,
  PushSubscription,
  TeamMembership,
  Player,
  User,
  Team,
  Season,
  CaptaincyAssignment,
  type ITeamAnnouncement,
  type AnnouncementCategory,
  type AnnouncementPriority,
} from '../models'
import { emitToRoom } from './broadcast'

// Configure VAPID for Web Push
const VAPID_PUBLIC_KEY = process.env.WEB_PUSH_PUBLIC_KEY || ''
const VAPID_PRIVATE_KEY = process.env.WEB_PUSH_PRIVATE_KEY || ''
const VAPID_SUBJECT = process.env.WEB_PUSH_SUBJECT || 'mailto:support@cricket.mediaiofficial.in'

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webPushClient.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  } catch (err) {
    console.warn('[WebPush] Warning initializing VAPID keys:', (err as Error)?.message)
  }
}

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY
}

// ---------------------------------------------------------------------------
// Email Template Builder
// ---------------------------------------------------------------------------

function formatCategoryLabel(cat: string): string {
  switch (cat) {
    case 'MATCH_REMINDER':
      return 'Match Reminder'
    case 'PRACTICE':
      return 'Practice Schedule'
    case 'MEETING':
      return 'Team Meeting'
    case 'UPDATE':
      return 'Important Update'
    case 'TOURNAMENT':
      return 'Tournament Information'
    case 'EMERGENCY':
      return 'Emergency Notice'
    default:
      return 'General Notice'
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function buildAnnouncementEmailHtml(opts: {
  teamName: string
  teamShort: string
  teamColor: string
  seasonName: string
  captainName: string
  title: string
  content: string
  category: AnnouncementCategory
  priority: AnnouncementPriority
  eventDate?: Date | null
  eventTime?: string | null
  location?: string | null
  portalUrl: string
}): { subject: string; html: string; text: string } {
  const categoryLabel = formatCategoryLabel(opts.category)
  const isUrgent = opts.priority === 'URGENT'
  const isImportant = opts.priority === 'IMPORTANT'

  const priorityBadge = isUrgent
    ? '<span style="display:inline-block;padding:3px 8px;font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#991B1B;background:#FEE2E2;border:1px solid #FCA5A5;border-radius:9999px;">URGENT</span>'
    : isImportant
      ? '<span style="display:inline-block;padding:3px 8px;font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#92400E;background:#FEF3C7;border:1px solid #FCD34D;border-radius:9999px;">IMPORTANT</span>'
      : ''

  const subject = isUrgent
    ? `[URGENT][${opts.teamShort}] ${categoryLabel}: ${opts.title}`
    : `[${opts.teamShort}] ${categoryLabel}: ${opts.title}`

  const eventBoxHtml =
    opts.eventDate || opts.eventTime || opts.location
      ? `
        <div style="margin:16px 0;padding:14px 18px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#6B7280;margin-bottom:6px;">Event Details</div>
          ${opts.eventDate ? `<div style="font-size:13px;color:#111827;margin-bottom:4px;"><strong>Date:</strong> ${new Date(opts.eventDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>` : ''}
          ${opts.eventTime ? `<div style="font-size:13px;color:#111827;margin-bottom:4px;"><strong>Time:</strong> ${escapeHtml(opts.eventTime)}</div>` : ''}
          ${opts.location ? `<div style="font-size:13px;color:#111827;"><strong>Location / Ground:</strong> ${escapeHtml(opts.location)}</div>` : ''}
        </div>
      `
      : ''

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin:0;padding:24px 12px;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #E5E7EB;border-radius:20px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);">
          <!-- Header Banner -->
          <div style="background:#7A1426;padding:24px 28px;color:#ffffff;border-bottom:3px solid #FBBF24;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
              <span style="font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#FDE68A;">Nexcore Premier League</span>
              <span style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.8);">${escapeHtml(opts.seasonName)}</span>
            </div>
            <h1 style="margin:10px 0 2px;font-size:20px;font-weight:900;color:#ffffff;line-height:1.2;">${escapeHtml(opts.teamName)}</h1>
            <div style="font-size:12px;color:rgba(255,255,255,0.85);">Official Captain's Announcement</div>
          </div>

          <!-- Body Content -->
          <div style="padding:28px;">
            <div style="margin-bottom:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span style="display:inline-block;padding:3px 10px;font-size:11px;font-weight:700;color:#1E3A8A;background:#DBEAFE;border:1px solid #BFDBFE;border-radius:9999px;">
                ${escapeHtml(categoryLabel)}
              </span>
              ${priorityBadge}
            </div>

            <h2 style="margin:0 0 14px;font-size:18px;font-weight:800;color:#111827;line-height:1.3;">
              ${escapeHtml(opts.title)}
            </h2>

            <div style="font-size:14px;line-height:1.6;color:#374151;white-space:pre-line;margin-bottom:18px;">
              ${escapeHtml(opts.content)}
            </div>

            ${eventBoxHtml}

            <!-- Captain Signoff -->
            <div style="margin-top:20px;padding-top:16px;border-top:1px solid #F3F4F6;display:flex;align-items:center;justify-content:space-between;font-size:12px;color:#6B7280;">
              <div>
                Posted by Captain: <strong style="color:#111827;">${escapeHtml(opts.captainName)}</strong>
              </div>
              <div>${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
            </div>

            <!-- Action Button -->
            <div style="margin-top:24px;text-align:center;">
              <a href="${opts.portalUrl}" style="display:inline-block;padding:12px 24px;background:#7A1426;color:#ffffff;font-size:13px;font-weight:700;text-decoration:none;border-radius:12px;box-shadow:0 2px 4px rgba(122,20,38,0.2);">
                Open in Player Career Hub &rarr;
              </a>
            </div>
          </div>

          <!-- Footer -->
          <div style="padding:16px 28px;background:#F9FAFB;border-top:1px solid #E5E7EB;font-size:11px;color:#9CA3AF;text-align:center;line-height:1.4;">
            This announcement was sent to registered members of <strong>${escapeHtml(opts.teamName)}</strong>.<br>
            Manage your notification preferences inside your NPL Player Portal.
          </div>
        </div>
      </body>
    </html>
  `.trim()

  const text = [
    `[${opts.teamName}] ${categoryLabel}: ${opts.title}`,
    isUrgent ? '*** URGENT NOTICE ***' : '',
    '',
    opts.content,
    '',
    opts.eventDate ? `Date: ${new Date(opts.eventDate).toLocaleDateString()}` : '',
    opts.eventTime ? `Time: ${opts.eventTime}` : '',
    opts.location ? `Location: ${opts.location}` : '',
    '',
    `Captain: ${opts.captainName}`,
    `View in Career Hub: ${opts.portalUrl}`,
  ]
    .filter(Boolean)
    .join('\n')

  return { subject, html, text }
}

// ---------------------------------------------------------------------------
// Resend Email Dispatcher
// ---------------------------------------------------------------------------

async function sendEmailViaResend(opts: {
  to: string
  subject: string
  html: string
  text: string
}): Promise<{ id: string | null }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured')

  const from = (process.env.EMAIL_FROM || 'Cricket Portal <otp@cricket.mediaiofficial.in>').trim()

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  })

  const payload = (await res.json().catch(() => null)) as {
    id?: string
    message?: string
    name?: string
  } | null

  if (!res.ok) {
    throw new Error(payload?.message || `Resend email request failed with HTTP ${res.status}`)
  }

  return { id: payload?.id ?? null }
}

// ---------------------------------------------------------------------------
// Core Announcement Publishing with Recipient Isolation & Queuing
// ---------------------------------------------------------------------------

export async function publishTeamAnnouncement(opts: {
  captainPlayerId: string
  teamId: string
  seasonId: string
  title: string
  content: string
  category: AnnouncementCategory
  priority: AnnouncementPriority
  eventDate?: Date | null
  eventTime?: string | null
  location?: string | null
  attachmentUrl?: string | null
}): Promise<ITeamAnnouncement> {
  // 1. Authorize: Verify captaincy assignment
  const activeAssignment = await CaptaincyAssignment.findOne({
    playerId: opts.captainPlayerId,
    teamId: opts.teamId,
    seasonId: opts.seasonId,
    status: 'active',
  }).lean()

  if (!activeAssignment) {
    throw new Error('You do not have an active captaincy assignment for this team and season')
  }

  // 2. Load Team, Season & Captain metadata
  const [team, season, captainPlayer] = await Promise.all([
    Team.findById(opts.teamId).lean(),
    Season.findById(opts.seasonId).lean(),
    Player.findById(opts.captainPlayerId).lean(),
  ])

  if (!team || !season || !captainPlayer) {
    throw new Error('Team, Season, or Captain record not found')
  }

  // 3. Save Announcement in MongoDB
  const announcement = await TeamAnnouncement.create({
    seasonId: opts.seasonId,
    teamId: opts.teamId,
    authorPlayerId: opts.captainPlayerId,
    title: opts.title.trim(),
    content: opts.content.trim(),
    category: opts.category,
    priority: opts.priority,
    eventDate: opts.eventDate ?? null,
    eventTime: opts.eventTime ? opts.eventTime.trim() : null,
    location: opts.location ? opts.location.trim() : null,
    attachmentUrl: opts.attachmentUrl ? opts.attachmentUrl.trim() : null,
    status: 'published',
    publishedAt: new Date(),
  })

  // 4. Identify strictly eligible squad members
  const memberships = await TeamMembership.find({
    teamId: opts.teamId,
    seasonId: opts.seasonId,
    status: { $in: ['ACTIVE', 'COMPLETED'] },
  }).lean()

  const squadPlayerIds = Array.from(new Set(memberships.map((m) => m.playerId)))

  // 5. Gather linked user accounts for email delivery
  const [users, allPreferences, pushSubscriptions] = await Promise.all([
    User.find({ playerId: { $in: squadPlayerIds } })
      .select({ playerId: 1, email: 1, name: 1 })
      .lean(),
    NotificationPreferences.find({ playerId: { $in: squadPlayerIds } }).lean(),
    PushSubscription.find({ playerId: { $in: squadPlayerIds } }).lean(),
  ])

  const userEmailMap = new Map<string, string>()
  users.forEach((u) => {
    if (u.playerId && u.email) userEmailMap.set(u.playerId, u.email.trim().toLowerCase())
  })

  const prefMap = new Map<string, (typeof allPreferences)[0]>()
  allPreferences.forEach((p) => prefMap.set(p.playerId, p))

  const pushSubsByPlayer = new Map<string, typeof pushSubscriptions>()
  pushSubscriptions.forEach((sub) => {
    const list = pushSubsByPlayer.get(sub.playerId) ?? []
    list.push(sub)
    pushSubsByPlayer.set(sub.playerId, list)
  })

  // 6. Create in-app notifications and queue delivery jobs
  const inAppDocs: Array<Record<string, any>> = []
  const deliveryJobDocs: Array<Record<string, any>> = []

  for (const playerId of squadPlayerIds) {
    // A. In-App Notification (Guaranteed delivery inside portal)
    inAppDocs.push({
      recipientPlayerId: playerId,
      announcementId: announcement._id,
      teamId: opts.teamId,
      seasonId: opts.seasonId,
      type: 'team_announcement',
      title: opts.title.trim(),
      content: opts.content.trim(),
      category: opts.category,
      priority: opts.priority,
      eventDate: opts.eventDate ?? null,
      eventTime: opts.eventTime ?? null,
      location: opts.location ?? null,
      attachmentUrl: opts.attachmentUrl ?? null,
      isRead: false,
    })

    const playerPref = prefMap.get(playerId)
    const categoryAllowed = playerPref
      ? playerPref.categoryPreferences[opts.category] !== false
      : true

    // Emergency and Urgent notices bypass category disable
    const bypassCatCheck = opts.priority === 'URGENT' || opts.category === 'EMERGENCY'

    // B. Email Delivery Job
    const playerEmail = userEmailMap.get(playerId)
    const emailEnabled = playerPref ? playerPref.emailEnabled !== false : true

    if (playerEmail && (emailEnabled || bypassCatCheck) && (categoryAllowed || bypassCatCheck)) {
      deliveryJobDocs.push({
        announcementId: announcement._id,
        recipientPlayerId: playerId,
        recipientEmail: playerEmail,
        channel: 'email',
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        nextRetryAt: new Date(),
      })
    }

    // C. Web Push Delivery Jobs
    const pushEnabled = playerPref ? playerPref.pushEnabled !== false : true
    const playerSubs = pushSubsByPlayer.get(playerId) ?? []

    if (
      playerSubs.length > 0 &&
      (pushEnabled || bypassCatCheck) &&
      (categoryAllowed || bypassCatCheck)
    ) {
      for (const sub of playerSubs) {
        deliveryJobDocs.push({
          announcementId: announcement._id,
          recipientPlayerId: playerId,
          subscriptionEndpoint: sub.endpoint,
          channel: 'push',
          status: 'pending',
          attempts: 0,
          maxAttempts: 3,
          nextRetryAt: new Date(),
        })
      }
    }
  }

  // Insert in-app notifications
  if (inAppDocs.length > 0) {
    await InAppNotification.insertMany(inAppDocs, { ordered: false }).catch((err) => {
      console.warn('[Notifications] InsertMany partial collision handled:', err?.message)
    })
  }

  // Insert delivery jobs
  if (deliveryJobDocs.length > 0) {
    await NotificationDeliveryJob.insertMany(deliveryJobDocs, { ordered: false }).catch((err) => {
      console.warn('[DeliveryJobs] InsertMany partial collision handled:', err?.message)
    })
  }

  // 7. Real-Time Socket.IO broadcast to online team players
  for (const playerId of squadPlayerIds) {
    void emitToRoom(`player:${playerId}`, 'notification:new', {
      announcementId: announcement._id,
      title: announcement.title,
      category: announcement.category,
      priority: announcement.priority,
      teamName: team.name,
      captainName: captainPlayer.name,
      createdAt: announcement.createdAt,
    })
  }

  // 8. Trigger background delivery queue without blocking HTTP response
  setImmediate(() => {
    void processDeliveryJobs()
  })

  return announcement.toObject()
}

// ---------------------------------------------------------------------------
// Background Delivery Queue Worker
// ---------------------------------------------------------------------------

let isProcessingQueue = false

export async function processDeliveryJobs(): Promise<void> {
  if (isProcessingQueue) return
  isProcessingQueue = true

  try {
    const portalUrl = (process.env.CLIENT_URL || 'http://localhost:3000') + '/player/dashboard?tab=notifications'

    // Fetch batch of up to 25 pending jobs due for processing
    const jobs = await NotificationDeliveryJob.find({
      status: 'pending',
      nextRetryAt: { $lte: new Date() },
    })
      .sort({ nextRetryAt: 1 })
      .limit(25)
      .lean()

    if (jobs.length === 0) {
      isProcessingQueue = false
      return
    }

    for (const job of jobs) {
      // Atomic claim to avoid concurrent workers picking the same job
      const claimed = await NotificationDeliveryJob.findOneAndUpdate(
        { _id: job._id, status: 'pending' },
        { status: 'processing' },
        { new: true }
      )
      if (!claimed) continue

      try {
        const announcement = await TeamAnnouncement.findById(claimed.announcementId).lean()
        if (!announcement) {
          await NotificationDeliveryJob.updateOne(
            { _id: claimed._id },
            { status: 'failed', lastError: 'Announcement not found' }
          )
          continue
        }

        const [team, season, captain] = await Promise.all([
          Team.findById(announcement.teamId).lean(),
          Season.findById(announcement.seasonId).lean(),
          Player.findById(announcement.authorPlayerId).lean(),
        ])

        if (claimed.channel === 'email' && claimed.recipientEmail) {
          // Send Email via Resend
          const emailContent = buildAnnouncementEmailHtml({
            teamName: team?.name || 'Your Team',
            teamShort: team?.shortName || 'NPL',
            teamColor: team?.color || '#7A1426',
            seasonName: season?.name || 'Current Season',
            captainName: captain?.name || 'Team Captain',
            title: announcement.title,
            content: announcement.content,
            category: announcement.category,
            priority: announcement.priority,
            eventDate: announcement.eventDate,
            eventTime: announcement.eventTime,
            location: announcement.location,
            portalUrl,
          })

          const sent = await sendEmailViaResend({
            to: claimed.recipientEmail,
            subject: emailContent.subject,
            html: emailContent.html,
            text: emailContent.text,
          })

          await NotificationDeliveryJob.updateOne(
            { _id: claimed._id },
            {
              status: 'sent',
              providerMessageId: sent.id,
              sentAt: new Date(),
              attempts: claimed.attempts + 1,
            }
          )
        } else if (claimed.channel === 'push' && claimed.subscriptionEndpoint) {
          // Send Web Push
          const subscription = await PushSubscription.findOne({
            endpoint: claimed.subscriptionEndpoint,
          }).lean()

          if (!subscription) {
            await NotificationDeliveryJob.updateOne(
              { _id: claimed._id },
              { status: 'failed', lastError: 'Subscription not found' }
            )
            continue
          }

          const pushPayload = JSON.stringify({
            title: `[${team?.shortName || 'NPL'}] ${formatCategoryLabel(announcement.category)}: ${announcement.title}`,
            body: announcement.content.length > 120
              ? announcement.content.slice(0, 117) + '...'
              : announcement.content,
            icon: '/apl-icon-s9.png',
            badge: '/apl-icon-s9.png',
            tag: `announcement-${announcement._id}`,
            data: {
              url: portalUrl,
              announcementId: announcement._id,
            },
          })

          await webPushClient.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: subscription.keys,
            },
            pushPayload
          )

          await NotificationDeliveryJob.updateOne(
            { _id: claimed._id },
            {
              status: 'sent',
              sentAt: new Date(),
              attempts: claimed.attempts + 1,
            }
          )
        }
      } catch (err: any) {
        const errorMsg = err?.message || 'Delivery error'
        const statusCode = err?.statusCode || err?.status

        // Clean up expired push subscriptions
        if (claimed.channel === 'push' && (statusCode === 404 || statusCode === 410)) {
          await PushSubscription.deleteOne({ endpoint: claimed.subscriptionEndpoint }).catch(
            () => null
          )
          await NotificationDeliveryJob.updateOne(
            { _id: claimed._id },
            {
              status: 'failed',
              lastError: 'Subscription expired or unregistered (410)',
              failedAt: new Date(),
            }
          )
          continue
        }

        const nextAttempts = claimed.attempts + 1
        if (nextAttempts >= claimed.maxAttempts) {
          await NotificationDeliveryJob.updateOne(
            { _id: claimed._id },
            {
              status: 'failed',
              attempts: nextAttempts,
              lastError: errorMsg,
              failedAt: new Date(),
            }
          )
        } else {
          // Exponential backoff: 15s, 45s, 120s
          const delayMs = Math.pow(3, nextAttempts) * 5000
          await NotificationDeliveryJob.updateOne(
            { _id: claimed._id },
            {
              status: 'pending',
              attempts: nextAttempts,
              lastError: errorMsg,
              nextRetryAt: new Date(Date.now() + delayMs),
            }
          )
        }
      }

      // Small pacing delay between deliveries to respect rate limits
      await new Promise((r) => setTimeout(r, 150))
    }
  } catch (err) {
    console.error('[DeliveryQueue] Worker error:', err)
  } finally {
    isProcessingQueue = false
  }
}

// ---------------------------------------------------------------------------
// Server Recovery: Reset interrupted jobs on server restart
// ---------------------------------------------------------------------------

export async function recoverPendingDeliveryJobs(): Promise<void> {
  try {
    const recovered = await NotificationDeliveryJob.updateMany(
      { status: 'processing' },
      { status: 'pending', nextRetryAt: new Date() }
    )
    if (recovered.modifiedCount > 0) {
      console.log(`[DeliveryQueue] Recovered ${recovered.modifiedCount} interrupted delivery jobs`)
    }
    void processDeliveryJobs()
  } catch (err) {
    console.error('[DeliveryQueue] Recovery error:', err)
  }
}

// ---------------------------------------------------------------------------
// Announcement Delivery Report Aggregator
// ---------------------------------------------------------------------------

export interface DeliveryReportDto {
  announcementId: string
  title: string
  teamName: string
  seasonName: string
  publishedAt: Date
  eligibleRecipientsCount: number
  inAppCreatedCount: number
  inAppReadCount: number
  emailJobsQueued: number
  emailJobsSent: number
  emailJobsFailed: number
  pushAttempts: number
  pushSent: number
  pushFailed: number
}

export async function getAnnouncementDeliveryReport(
  announcementId: string,
  captainPlayerId: string
): Promise<DeliveryReportDto> {
  const announcement = await TeamAnnouncement.findById(announcementId).lean()
  if (!announcement) throw new Error('Announcement not found')

  // Verify captain ownership
  const activeAssignment = await CaptaincyAssignment.findOne({
    playerId: captainPlayerId,
    teamId: announcement.teamId,
    seasonId: announcement.seasonId,
  }).lean()

  if (!activeAssignment && announcement.authorPlayerId !== captainPlayerId) {
    throw new Error('Unauthorized access to delivery report')
  }

  const [team, season, memberships, inAppTotal, inAppReadCount, emailJobs, pushJobs] =
    await Promise.all([
      Team.findById(announcement.teamId).lean(),
      Season.findById(announcement.seasonId).lean(),
      TeamMembership.find({
        teamId: announcement.teamId,
        seasonId: announcement.seasonId,
        status: { $in: ['ACTIVE', 'COMPLETED'] },
      }).lean(),
      InAppNotification.countDocuments({ announcementId }),
      InAppNotification.countDocuments({ announcementId, isRead: true }),
      NotificationDeliveryJob.find({ announcementId, channel: 'email' }).lean(),
      NotificationDeliveryJob.find({ announcementId, channel: 'push' }).lean(),
    ])

  const emailSent = emailJobs.filter((j) => j.status === 'sent').length
  const emailFailed = emailJobs.filter((j) => j.status === 'failed').length

  const pushSent = pushJobs.filter((j) => j.status === 'sent').length
  const pushFailed = pushJobs.filter((j) => j.status === 'failed').length

  return {
    announcementId,
    title: announcement.title,
    teamName: team?.name || 'Assigned Team',
    seasonName: season?.name || 'Active Season',
    publishedAt: announcement.publishedAt,
    eligibleRecipientsCount: memberships.length,
    inAppCreatedCount: inAppTotal,
    inAppReadCount,
    emailJobsQueued: emailJobs.length,
    emailJobsSent: emailSent,
    emailJobsFailed: emailFailed,
    pushAttempts: pushJobs.length,
    pushSent,
    pushFailed,
  }
}
