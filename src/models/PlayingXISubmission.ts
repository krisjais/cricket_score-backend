import { Schema, model } from 'mongoose'
import { randomUUID } from 'crypto'
import { baseSchemaOptions } from './schema-helpers'

export type PlayingXIStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'

export interface IPlayingXISubmission {
  _id: string
  id: string
  matchId: string
  teamId: string
  seasonId: string
  captainId: string
  submittedBy: string
  playingXI: string[]
  substitutes: string[]
  notes: string | null
  status: PlayingXIStatus
  reviewNotes: string | null
  reviewedBy: string | null
  reviewedAt: Date | null
  submittedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const PlayingXISubmissionSchema = new Schema<IPlayingXISubmission>(
  {
    _id: { type: String, default: () => randomUUID() },
    matchId: { type: String, required: true, ref: 'Match', index: true },
    teamId: { type: String, required: true, ref: 'Team', index: true },
    seasonId: { type: String, required: true, ref: 'Season', index: true },
    captainId: { type: String, required: true, ref: 'Player', index: true },
    submittedBy: { type: String, required: true, trim: true },
    playingXI: { type: [String], default: [] },
    substitutes: { type: [String], default: [] },
    notes: { type: String, default: null, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'],
      default: 'DRAFT',
      index: true,
    },
    reviewNotes: { type: String, default: null, trim: true, maxlength: 500 },
    reviewedBy: { type: String, default: null, trim: true },
    reviewedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
  },
  baseSchemaOptions('playingXISubmissions', { timestamps: true })
)

// One submission record per team per match
PlayingXISubmissionSchema.index({ matchId: 1, teamId: 1 }, { unique: true })
PlayingXISubmissionSchema.index({ seasonId: 1, teamId: 1, status: 1 })

PlayingXISubmissionSchema.virtual('id').get(function (this: IPlayingXISubmission) {
  return this._id
})

export const PlayingXISubmission = model<IPlayingXISubmission>(
  'PlayingXISubmission',
  PlayingXISubmissionSchema
)

