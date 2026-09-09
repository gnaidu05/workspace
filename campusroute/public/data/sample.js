// Seed content for a brand-new plan.
//
// Demo stops deliberately carry no campus coordinates: they are priced from the
// city reference point, and the UI says so. Real planning starts when a person
// searches for the actual campus and confirms its pin.

import { DEFAULT_SETTINGS } from '../engine.js';

const id = (n) => 'demo-' + n;

export function demoPlan() {
  return {
    schema: 1,
    base: 'Bangalore',
    settings: { ...DEFAULT_SETTINGS },
    locations: {},
    overrides: {},
    demo: true,
    teams: [
      { id: 't1', name: 'Team Alpha', size: 2, members: ['A. Rao', 'S. Menon'] },
      { id: 't2', name: 'Team Bravo', size: 2, base: 'Pune', members: ['K. Iyer', 'D. Bose'] },
      { id: 't3', name: 'Team Charlie', size: 2, members: [] }
    ],
    colleges: [
      { id: id(1), name: 'Kozhikode campus (demo)', city: 'Kozhikode', date: '2026-09-24', time: '09:00', duration: 6, team: 'auto' },
      { id: id(2), name: 'Palakkad campus (demo)', city: 'Palakkad', date: '2026-09-25', time: '09:00', duration: 6, team: 'auto' },
      { id: id(3), name: 'Coimbatore campus (demo)', city: 'Coimbatore', date: '2026-09-26', time: '09:00', duration: 6, team: 'auto' },
      { id: id(4), name: 'Kanchipuram campus (demo)', city: 'Kanchipuram', date: '2026-09-28', time: '09:00', duration: 6, team: 'auto' },
      {
        id: id(5), name: 'Puducherry campus (demo)', city: 'Puducherry', date: '2026-09-29', time: '09:00', duration: 6, team: 'auto',
        interviewDate: '2026-09-30', interviewTime: '09:00', interviewDuration: 4
      },
      { id: id(6), name: 'Pune campus (demo)', city: 'Pune', date: '2026-09-24', time: '09:00', duration: 6, team: 'auto' },
      { id: id(7), name: 'Mumbai campus (demo)', city: 'Mumbai', date: '2026-09-25', time: '09:00', duration: 6, team: 'auto' },
      { id: id(8), name: 'Nagpur campus (demo)', city: 'Nagpur', date: '2026-10-01', time: '10:00', duration: 5, team: 'auto' }
    ]
  };
}

// An optional starter list: well-known institutions with their city only, so a
// new plan can be filled in by adding dates rather than typing names. No
// coordinates are asserted here — confirm each campus pin before planning.
export const STARTER_COLLEGES = [
  ['Indian Institute of Science', 'Bangalore'],
  ['Indian Institute of Technology Madras', 'Chennai'],
  ['Indian Institute of Technology Bombay', 'Mumbai'],
  ['Indian Institute of Technology Delhi', 'Delhi'],
  ['Indian Institute of Technology Kanpur', 'Lucknow'],
  ['Indian Institute of Technology Roorkee', 'Dehradun'],
  ['Indian Institute of Technology Hyderabad', 'Hyderabad'],
  ['Indian Institute of Technology Indore', 'Indore'],
  ['College of Engineering, Pune', 'Pune'],
  ['Visvesvaraya National Institute of Technology', 'Nagpur'],
  ['National Institute of Technology Karnataka', 'Mangaluru'],
  ['National Institute of Technology Tiruchirappalli', 'Tiruchirappalli'],
  ['National Institute of Technology Calicut', 'Kozhikode'],
  ['National Institute of Technology Rourkela', 'Bhubaneswar'],
  ['Jadavpur University', 'Kolkata'],
  ['Anna University', 'Chennai'],
  ['Osmania University', 'Hyderabad'],
  ['Savitribai Phule Pune University', 'Pune'],
  ['Panjab University', 'Chandigarh'],
  ['Cochin University of Science and Technology', 'Kochi'],
  ['Manipal Institute of Technology', 'Mangaluru'],
  ['PSG College of Technology', 'Coimbatore'],
  ['Thiagarajar College of Engineering', 'Madurai'],
  ['Sardar Vallabhbhai National Institute of Technology', 'Surat']
];

export function starterColleges() {
  return STARTER_COLLEGES.map(([name, city], i) => ({
    id: 'starter-' + (i + 1),
    name,
    city,
    date: '',
    time: '09:00',
    duration: 6,
    team: 'auto',
    demo: false,
    airport: 'auto'
  }));
}
