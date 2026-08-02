import { describe, expect, it } from '@jest/globals';

import {
  classifyEvent,
  expandAllDayDates,
  inferOutOfTownResult,
  inferOutOfTownStatuses,
  normalizeGoogleEvent,
  type NormalizedCalendarEvent,
} from './outOfTown';

/**
 * Representative event scenarios for the PRA-9 out-of-town inference rules.
 * Runs under the repo's Jest config (PRA-29). Pure logic, no I/O.
 */

// Build an all-day event with sane defaults; override what a case cares about.
function allDay(
  overrides: Partial<NormalizedCalendarEvent> &
    Pick<NormalizedCalendarEvent, 'id' | 'start' | 'end'>
): NormalizedCalendarEvent {
  return {
    summary: '',
    eventType: 'default',
    isAllDay: true,
    status: 'confirmed',
    ...overrides,
  };
}

describe('classifyEvent', () => {
  it('treats an all-day vacation as out-of-town evidence', () => {
    const signal = classifyEvent(
      allDay({ id: '1', summary: 'Vacation 🏖️', start: '2026-08-01', end: '2026-08-05' })
    );
    expect(signal.kind).toBe('out_of_town');
  });

  it('treats a native all-day out-of-office event as out-of-town', () => {
    const signal = classifyEvent(
      allDay({ id: '1', eventType: 'outOfOffice', start: '2026-08-01', end: '2026-08-02' })
    );
    expect(signal.kind).toBe('out_of_town');
  });

  it('matches keywords on word boundaries (no false positive on "triple")', () => {
    const signal = classifyEvent(
      allDay({ id: '1', summary: 'Triple espresso tasting', start: '2026-08-01', end: '2026-08-02' })
    );
    expect(signal.kind).toBe('ignored');
  });

  it('ignores a timed event even when its title mentions travel', () => {
    const flight: NormalizedCalendarEvent = {
      id: '1',
      summary: 'Flight to NYC',
      eventType: 'default',
      isAllDay: false,
      start: '2026-08-01T09:00:00Z',
      end: '2026-08-01T12:00:00Z',
      status: 'confirmed',
    };
    expect(classifyEvent(flight).kind).toBe('ignored');
  });

  it('ignores declined and cancelled events', () => {
    expect(
      classifyEvent(
        allDay({ id: '1', summary: 'Vacation', start: '2026-08-01', end: '2026-08-02', responseStatus: 'declined' })
      ).kind
    ).toBe('ignored');
    expect(
      classifyEvent(
        allDay({ id: '2', summary: 'Vacation', start: '2026-08-01', end: '2026-08-02', status: 'cancelled' })
      ).kind
    ).toBe('ignored');
  });

  it('produces no signal for an unrelated all-day event', () => {
    expect(
      classifyEvent(
        allDay({ id: '1', summary: "Mom's birthday", eventType: 'birthday', start: '2026-08-01', end: '2026-08-02' })
      ).kind
    ).toBe('ignored');
  });

  it('lets an explicit in-town keyword win over out-of-town on the same event', () => {
    const signal = classifyEvent(
      allDay({ id: '1', summary: 'Back in town (was on a trip)', start: '2026-08-05', end: '2026-08-06' })
    );
    expect(signal.kind).toBe('in_town');
  });
});

describe('expandAllDayDates (Google exclusive-end semantics)', () => {
  it('covers exactly one day for a single all-day event', () => {
    expect(expandAllDayDates('2026-08-01', '2026-08-02')).toEqual(['2026-08-01']);
  });

  it('covers start..end-1 for a multi-day event', () => {
    expect(expandAllDayDates('2026-08-01', '2026-08-04')).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
    ]);
  });

  it('collapses a malformed end (<= start) to a single day', () => {
    expect(expandAllDayDates('2026-08-01', '2026-07-30')).toEqual(['2026-08-01']);
  });

  it('crosses month/year boundaries correctly', () => {
    expect(expandAllDayDates('2026-12-31', '2027-01-02')).toEqual(['2026-12-31', '2027-01-01']);
  });
});

describe('inferOutOfTownStatuses', () => {
  it('infers out-of-town for each day a vacation range covers', () => {
    const result = inferOutOfTownStatuses([
      allDay({ id: 'v', summary: 'Vacation', start: '2026-08-01', end: '2026-08-04' }),
    ]);
    expect([...result.keys()]).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
    expect(result.get('2026-08-02')?.status).toBe('out_of_town');
  });

  it('lets an explicit in-town day win inside a broad vacation block (conflict handling)', () => {
    const result = inferOutOfTownStatuses([
      allDay({ id: 'vac', summary: 'Vacation', start: '2026-08-01', end: '2026-08-11' }),
      allDay({ id: 'home', summary: 'Back in town for the day', start: '2026-08-05', end: '2026-08-06' }),
    ]);
    expect(result.get('2026-08-04')?.status).toBe('out_of_town');
    expect(result.get('2026-08-05')?.status).toBe('in_town');
    expect(result.get('2026-08-06')?.status).toBe('out_of_town');
  });

  it('unions the source ids of overlapping out-of-town events', () => {
    const result = inferOutOfTownStatuses([
      allDay({ id: 'a', summary: 'OOO', start: '2026-08-01', end: '2026-08-03' }),
      allDay({ id: 'b', summary: 'Trip', start: '2026-08-02', end: '2026-08-04' }),
    ]);
    expect(result.get('2026-08-02')?.sourceEventIds.sort()).toEqual(['a', 'b']);
    expect(result.get('2026-08-01')?.status).toBe('out_of_town');
  });

  it('contributes no dates for ignored events', () => {
    const result = inferOutOfTownStatuses([
      allDay({ id: 'x', summary: 'Sprint planning week', start: '2026-08-01', end: '2026-08-06' }),
    ]);
    expect(result.size).toBe(0);
  });

  it('drops dates outside the requested range', () => {
    const result = inferOutOfTownStatuses(
      [allDay({ id: 'v', summary: 'Vacation', start: '2026-08-01', end: '2026-08-06' })],
      { rangeStart: '2026-08-03', rangeEnd: '2026-08-04' }
    );
    expect([...result.keys()]).toEqual(['2026-08-03', '2026-08-04']);
  });

  it('is deterministic regardless of event input order', () => {
    const events = [
      allDay({ id: 'vac', summary: 'Vacation', start: '2026-08-01', end: '2026-08-11' }),
      allDay({ id: 'home', summary: 'Staycation', start: '2026-08-05', end: '2026-08-06' }),
    ];
    const forward = [...inferOutOfTownStatuses(events)].map(([d, i]) => [d, i.status]);
    const reversed = [...inferOutOfTownStatuses([...events].reverse())].map(([d, i]) => [d, i.status]);
    expect(forward).toEqual(reversed);
  });
});

describe('inferOutOfTownResult (PRA-10 contract)', () => {
  it('returns sorted out-of-town dates clamped to the window, passing syncedAt through', () => {
    const result = inferOutOfTownResult(
      [
        allDay({ id: 'v', summary: 'Vacation', start: '2026-08-01', end: '2026-08-06' }),
        allDay({ id: 'home', summary: 'Back in town', start: '2026-08-03', end: '2026-08-04' }),
      ],
      { start: '2026-08-02', end: '2026-08-05' },
      '2026-08-02T10:00:00.000Z'
    );
    // 08-01 outside window; 08-03 is an explicit in-town day -> excluded.
    expect(result.outOfTownDates).toEqual(['2026-08-02', '2026-08-04', '2026-08-05']);
    expect(result.window).toEqual({ start: '2026-08-02', end: '2026-08-05' });
    expect(result.syncedAt).toBe('2026-08-02T10:00:00.000Z');
  });

  it('returns an empty date set when only ambiguous events are present', () => {
    const result = inferOutOfTownResult(
      [allDay({ id: 'x', summary: 'Team lunch', start: '2026-08-02', end: '2026-08-03' })],
      { start: '2026-08-01', end: '2026-08-31' },
      '2026-08-02T10:00:00.000Z'
    );
    expect(result.outOfTownDates).toEqual([]);
  });
});

describe('normalizeGoogleEvent', () => {
  it('parses an all-day out-of-office event and the user RSVP', () => {
    const normalized = normalizeGoogleEvent({
      id: 'g1',
      summary: 'Out of office',
      eventType: 'outOfOffice',
      status: 'confirmed',
      start: { date: '2026-08-01' },
      end: { date: '2026-08-04' },
      attendees: [
        { self: false, responseStatus: 'accepted' },
        { self: true, responseStatus: 'accepted' },
      ],
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.isAllDay).toBe(true);
    expect(normalized?.eventType).toBe('outOfOffice');
    expect(normalized?.responseStatus).toBe('accepted');
    expect(classifyEvent(normalized!).kind).toBe('out_of_town');
  });

  it('flags a timed event as not all-day', () => {
    const normalized = normalizeGoogleEvent({
      id: 'g2',
      summary: 'Standup',
      start: { dateTime: '2026-08-01T09:00:00Z' },
      end: { dateTime: '2026-08-01T09:15:00Z' },
    });
    expect(normalized?.isAllDay).toBe(false);
  });

  it('returns null for events missing an id or a start', () => {
    expect(normalizeGoogleEvent({ summary: 'no id', start: { date: '2026-08-01' } })).toBeNull();
    expect(normalizeGoogleEvent({ id: 'x', summary: 'no start' })).toBeNull();
  });
});
