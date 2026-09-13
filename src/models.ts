import { Schema, model } from 'mongoose';

const volunteerSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
}, { timestamps: true });

const signupSchema = new Schema({
  volunteerId: { type: Schema.Types.ObjectId, ref: 'Volunteer', required: true },
  signedUpAt: { type: Date, required: true, default: Date.now },
}, { _id: false });

const shiftSchema = new Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  location: { type: String, required: true },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  capacity: { type: Number, required: true, min: 1, max: 500 },
  signups: { type: [signupSchema], default: [] },
}, { timestamps: true });

shiftSchema.index({ startsAt: 1, _id: 1 });
shiftSchema.index({ 'signups.volunteerId': 1 });

export const Volunteer = model('Volunteer', volunteerSchema);
export const Shift = model('Shift', shiftSchema);
