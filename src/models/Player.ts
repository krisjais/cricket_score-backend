import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'
import { baseSchemaOptions } from './schema-helpers'

export type BattingStyle = 'RIGHT_HAND' | 'LEFT_HAND'
export type BowlingStyle =
  | 'RIGHT_ARM_FAST'
  | 'RIGHT_ARM_MEDIUM'
  | 'RIGHT_ARM_OFF_SPIN'
  | 'RIGHT_ARM_LEG_SPIN'
  | 'LEFT_ARM_FAST'
  | 'LEFT_ARM_MEDIUM'
  | 'LEFT_ARM_ORTHODOX'
  | 'LEFT_ARM_CHINAMAN'
  | 'NONE'
export type PlayerAccountStatus = 'ACTIVE' | 'SUSPENDED' | 'MERGED' | 'RETIRED'

export interface IPlayerPrivacy {
  showDob: boolean
  showCity: boolean
  showBio: boolean
  showSeasonHistory: boolean
  isPublic: boolean
}

export interface IPlayer {
  _id: string
  id: string
  playerCode: string | null
  userId: string | null
  name: string
  jerseyNumber: number | null
  role: string
  gender: 'MALE' | 'FEMALE'
  teamId: string | null
  avatarUrl?: string | null
  dob?: Date | null
  battingStyle?: BattingStyle | null
  bowlingStyle?: BowlingStyle | null
  bio?: string | null
  city?: string | null
  isClaimed: boolean
  isVerified: boolean
  status: PlayerAccountStatus
  mergedIntoPlayerId: string | null
  privacy: IPlayerPrivacy
  createdAt: Date
  updatedAt?: Date
}

const PlayerSchema = new Schema<IPlayer>(
  {
    _id: { type: String, default: () => randomUUID() },
    playerCode: { type: String, default: null, uppercase: true, trim: true },
    userId: { type: String, default: null, ref: 'User' },
    name: { type: String, required: true, trim: true },
    jerseyNumber: { type: Number, default: null },
    role: {
      type: String,
      enum: ['BATTER', 'BOWLER', 'ALL_ROUNDER', 'WICKETKEEPER'],
      default: 'ALL_ROUNDER',
    },
    gender: {
      type: String,
      enum: ['MALE', 'FEMALE'],
      default: 'MALE',
    },
    teamId: { type: String, default: null, ref: 'Team', index: true },
    avatarUrl: { type: String, default: null },
    dob: { type: Date, default: null },
    battingStyle: { type: String, enum: ['RIGHT_HAND', 'LEFT_HAND', null], default: null },
    bowlingStyle: {
      type: String,
      enum: [
        'RIGHT_ARM_FAST',
        'RIGHT_ARM_MEDIUM',
        'RIGHT_ARM_OFF_SPIN',
        'RIGHT_ARM_LEG_SPIN',
        'LEFT_ARM_FAST',
        'LEFT_ARM_MEDIUM',
        'LEFT_ARM_ORTHODOX',
        'LEFT_ARM_CHINAMAN',
        'NONE',
        null,
      ],
      default: null,
    },
    bio: { type: String, default: null, maxlength: 400 },
    city: { type: String, default: null, trim: true, maxlength: 80 },
    isClaimed: { type: Boolean, default: false, index: true },
    isVerified: { type: Boolean, default: false, index: true },
    status: {
      type: String,
      enum: ['ACTIVE', 'SUSPENDED', 'MERGED', 'RETIRED'],
      default: 'ACTIVE',
      index: true,
    },
    mergedIntoPlayerId: { type: String, default: null, ref: 'Player' },
    privacy: {
      showDob: { type: Boolean, default: false },
      showCity: { type: Boolean, default: true },
      showBio: { type: Boolean, default: true },
      showSeasonHistory: { type: Boolean, default: true },
      isPublic: { type: Boolean, default: true },
    },
    createdAt: { type: Date, default: Date.now },
  },
  baseSchemaOptions(undefined, { timestamps: true })
)

// Partial unique indexes preserve backwards compatibility with existing Atlas documents during bootstrap migration
PlayerSchema.index(
  { playerCode: 1 },
  { unique: true, partialFilterExpression: { playerCode: { $type: 'string' } } }
)
PlayerSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { userId: { $type: 'string' } } }
)
PlayerSchema.index({ name: 1 })

PlayerSchema.virtual('id').get(function (this: IPlayer) {
  return this._id
})

export const Player = model<IPlayer>('Player', PlayerSchema)
