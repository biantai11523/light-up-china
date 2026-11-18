import { visibleEntries } from './profiles.js';

const normalize = value => value.normalize('NFKC').trim().toLowerCase();

export function findCities(cities, layers, view, { query, province, filter }) {
  const text = normalize(query);
  const words = text.split(/\s+/).filter(Boolean);
  const results = [];
  for (const city of cities) {
    if (province && city.provinceId !== province) continue;
    const entries = visibleEntries(layers, city.id, view);
    if (filter === 'lit' && !entries.length || filter === 'unlit' && entries.length) continue;
    const location = [normalize(city.name), normalize(city.province), city.id];
    const noteWords = words.filter(word => !location.some(field => field.includes(word)));
    const notes = entries.filter(entry => entry.record.note);
    const matchesNote = (entry, word) => normalize(entry.record.note).includes(word);
    if (!noteWords.every(word => notes.some(entry => matchesNote(entry, word)))) continue;
    const preview = notes.find(entry => noteWords.some(word => matchesNote(entry, word))) || notes[0];
    // A city name or code should appear ahead of a passing mention in a note.
    let rank = 1;
    if (noteWords.length) rank = 2;
    else if (text && (location[0].startsWith(text) || city.id === text)) rank = 0;
    results.push({ city, entries, preview, rank });
  }
  return text ? results.sort((a, b) => a.rank - b.rank) : results;
}
