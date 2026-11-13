import { Router } from 'express'
import {
  InAppNotification,
  NotificationPreferences,
  PushSubscription,
} from '../models'
import { connectDB } from '../lib/db'
import { requirePlayer } from '../lib/player-auth'
import { sendOk, sendFail } from '../lib/api-utils'
import { getVapidPublicKey } from '../lib/notification-service'

const router = Router()

// GET /api/notifications/unread-count - Lightweight unread counter for notification bell
router.get('/unread-count', async (req, res) => {
  const pSess = await requirePlayer(req)
  if (!pSess) return sendOk(res, { unreadCount: 0 })

  try {
    await connectDB()
    const count = await InAppNotification.countDocuments({
      recipientPlayerId: pSess.playerId,
      isRead: false,
    })

    return sendOk(res, { unreadCount: count })
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to load unread count', 500)
  }
})

// GET /api/notifications - List player notifications with status & category filter
router.get('/', async (req, res) => {
  const pSess = await requirePlayer(req)
  if (!pSess) return sendFail(res, 'Player authentication required', 401)

  try {
    await connectDB()
    const { status, category, limit = '50' } = req.query

    const filter: Record<string, any> = {
      recipientPlayerId: pSess.playerId,
    }

    if (status === 'unread') {
      filter.isRead = false
    } else if (status === 'read') {
      filter.isRead = true
    }

    if (typeof category === 'string' && category && category !== 'ALL') {
      filter.category = category
    }

    const maxItems = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 100)

    const notifications = await InAppNotification.find(filter)
      .sort({ createdAt: -1 })
      .limit(maxItems)
      .populate('teamId', 'name shortName color logoUrl')
      .lean()

    const unreadCount = await InAppNotification.countDocuments({
      recipientPlayerId: pSess.playerId,
      isRead: false,
    })

    return sendOk(res, {
      notifications: notifications.map((n) => ({
        ...n,
        id: n._id,
        team: n.teamId,
      })),
      unreadCount,
    })
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to load notifications', 500)
  }
})

// PATCH /api/notifications/:id/read - Mark single notification as read
router.patch('/:id/read', async (req, res) => {
  const pSess = await requirePlayer(req)
  if (!pSess) return sendFail(res, 'Player authentication required', 401)

  try {
    await connectDB()
    const updated = await InAppNotification.findOneAndUpdate(
      {
        _id: req.params.id,
        recipientPlayerId: pSess.playerId,
      },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      },
      { new: true }
    )

    if (!updated) return sendFail(res, 'Notification not found', 404)

    const unreadCount = await InAppNotification.countDocuments({
      recipientPlayerId: pSess.playerId,
      isRead: false,
    })

    return sendOk(res, { notification: updated.toObject(), unreadCount })
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to update notification', 500)
  }
})

// PATCH /api/notifications/read-all - Mark all unread notifications as read
router.patch('/read-all', async (req, res) => {
  const pSess = await requirePlayer(req)
  if (!pSess) return sendFail(res, 'Player authentication required', 401)

  try {
    await connectDB()
    const result = await InAppNotification.updateMany(
      {
        recipientPlayerId: pSess.playerId,
        isRead: false,
      },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      }
    )

    return sendOk(res, {
      markedCount: result.modifiedCount,
      unreadCount: 0,
    })
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to mark notifications as read', 500)
  }
})

// GET /api/notifications/preferences - Get player notification preferences
router.get('/preferences', async (req, res) => {
  const pSess = await requirePlayer(req)
  if (!pSess) return sendFail(res, 'Player authentication required', 401)

  try {
    await connectDB()
    let pref = await NotificationPreferences.findOne({ playerId: pSess.playerId }).lean()

    if (!pref) {
      const created = await NotificationPreferences.create({
        playerId: pSess.playerId,
        emailEnabled: true,
        pushEnabled: true,
        categoryPreferences: {
          GENERAL: true,
          PRACTICE: true,
          MATCH_REMINDER: true,
          MEETING: true,
          UPDATE: true,
          TOURNAMENT: true,
          EMERGENCY: true,
        },
      })
      pref = created.toObject()
    }

    const subscriptionsCount = await PushSubscription.countDocuments({
      playerId: pSess.playerId,
    })

    return sendOk(res, {
      preferences: pref,
      activePushDevicesCount: subscriptionsCount,
    })
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to load preferences', 500)
  }
})

// PUT /api/notifications/preferences - Update player notification preferences
router.put('/preferences', async (req, res) => {
  const pSess = await requirePlayer(req)
  if (!pSess) return sendFail(res, 'Player authentication required', 401)

  try {
    await connectDB()
    const { emailEnabled, pushEnabled, categoryPreferences } = req.body ?? {}

    const updateDoc: Record<string, any> = {}
    if (typeof emailEnabled === 'boolean') updateDoc.emailEnabled = emailEnabled
    if (typeof pushEnabled === 'boolean') updateDoc.pushEnabled = pushEnabled
    if (categoryPreferences && typeof categoryPreferences === 'object') {
      updateDoc.categoryPreferences = {
        GENERAL: Boolean(categoryPreferences.GENERAL ?? true),
        PRACTICE: Boolean(categoryPreferences.PRACTICE ?? true),
        MATCH_REMINDER: Boolean(categoryPreferences.MATCH_REMINDER ?? true),
        MEETING: Boolean(categoryPreferences.MEETING ?? true),
        UPDATE: Boolean(categoryPreferences.UPDATE ?? true),
        TOURNAMENT: Boolean(categoryPreferences.TOURNAMENT ?? true),
        EMERGENCY: true, // Emergency is always true
      }
    }

    const updated = await NotificationPreferences.findOneAndUpdate(
      { playerId: pSess.playerId },
      { $set: updateDoc },
      { upsert: true, new: true }
    )

    return sendOk(res, { preferences: updated.toObject() })
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to update preferences', 500)
  }
})

// GET /api/notifications/push/public-key - Expose VAPID public key for browser subscription
router.get('/push/public-key', async (_req, res) => {
  const key = getVapidPublicKey()
  return sendOk(res, { publicKey: key })
})

// POST /api/notifications/push/subscribe - Register or update a browser push subscription
router.post('/push/subscribe', async (req, res) => {
  const pSess = await requirePlayer(req)
  if (!pSess) return sendFail(res, 'Player authentication required', 401)

  try {
    await connectDB()
    const { endpoint, keys, deviceInfo } = req.body ?? {}

    if (!endpoint || typeof endpoint !== 'string' || !keys?.p256dh || !keys?.auth) {
      return sendFail(res, 'Valid push subscription endpoint and keys are required')
    }

    const sub = await PushSubscription.findOneAndUpdate(
      { endpoint: endpoint.trim() },
      {
        $set: {
          playerId: pSess.playerId,
          endpoint: endpoint.trim(),
          keys: {
            p256dh: String(keys.p256dh).trim(),
            auth: String(keys.auth).trim(),
          },
          deviceInfo: typeof deviceInfo === 'string' ? deviceInfo.slice(0, 200) : null,
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    )

    // Ensure push is enabled in preferences when subscribing
    await NotificationPreferences.updateOne(
      { playerId: pSess.playerId },
      { $set: { pushEnabled: true } },
      { upsert: true }
    )

    return sendOk(res, { subscription: sub.toObject() }, 201)
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to save push subscription', 500)
  }
})

// DELETE /api/notifications/push/unsubscribe - Unregister a browser push subscription
router.delete('/push/unsubscribe', async (req, res) => {
  const pSess = await requirePlayer(req)
  if (!pSess) return sendFail(res, 'Player authentication required', 401)

  try {
    await connectDB()
    const { endpoint } = req.body ?? {}
    if (!endpoint || typeof endpoint !== 'string') {
      return sendFail(res, 'Endpoint is required')
    }

    await PushSubscription.deleteOne({
      endpoint: endpoint.trim(),
      playerId: pSess.playerId,
    })

    return sendOk(res, { success: true })
  } catch (err: any) {
    return sendFail(res, err?.message || 'Failed to unsubscribe push', 500)
  }
})

export default router
