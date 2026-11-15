'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { post } from '@/lib/api';
import type { LeaveRequest, LeaveStatus, StudentListItem } from '@/lib/api';
import { formatDate, formatRange, fullName } from '@/lib/format';
import { onSubmitForm, useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { useCampus } from '@/components/academic/campus-picker';
import { localToday } from '@/components/attendance/status';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  SelectField,
  Skeleton,
  Table,
  Td,
} from '@/components/ui';

const STATUS_TONE: Record<LeaveStatus, 'amber' | 'green' | 'red' | 'neutral'> = {
  pending: 'amber',
  approved: 'green',
  rejected: 'red',
  cancelled: 'neutral',
};
const VIA: Record<string, string> = {
  office: 'At the office',
  phone: 'By phone',
  parent_app: 'Parent app',
};

export default function LeavePage() {
  const { can } = useSession();
  const { campus, picker } = useCampus();
  const [status, setStatus] = useState<LeaveStatus | ''>('pending');
  const list = useApi<LeaveRequest[]>(
    campus ? `/attendance/leave?campusId=${campus.id}${status ? `&status=${status}` : ''}` : null,
  );
  const canRecord = campus
    ? can('attendance.mark', campus.id) || can('attendance.correct', campus.id)
    : false;

  return (
    <>
      <PageHeader
        title="Student leave"
        description="Leave approved by the class teacher marks the student “leave” in the register, including days already taken."
        actions={picker}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card
          title="Requests"
          actions={
            <SelectField
              label="Show"
              value={status}
              onChange={(e) => setStatus(e.target.value as LeaveStatus | '')}
              className="w-40"
            >
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
              <option value="">All</option>
            </SelectField>
          }
        >
          {list.error && <Alert>{list.error.message}</Alert>}
          {!list.data ? (
            <Skeleton rows={4} />
          ) : !list.data.length ? (
            <EmptyState
              title={status === 'pending' ? 'Nothing waiting for a decision' : 'No leave requests'}
            />
          ) : (
            <Table head={['Student', 'Dates', 'Reason', 'Status', '']}>
              {list.data.map((l) => (
                <LeaveRow key={l.id} leave={l} onDone={list.reload} />
              ))}
            </Table>
          )}
        </Card>
        {canRecord && campus && <RecordLeave onDone={list.reload} />}
      </div>
    </>
  );
}

function LeaveRow({ leave: l, onDone }: { leave: LeaveRequest; onDone: () => Promise<void> }) {
  const action = useAction();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const decide = async (status: 'approved' | 'rejected' | 'cancelled', n = '') => {
    if (await action.run(() => post(`/attendance/leave/${l.id}/decision`, { status, note: n }))) {
      setRejecting(false);
      await onDone();
    }
  };
  return (
    <tr>
      <Td>
        <Link className="font-medium hover:underline" href={`/students/${l.studentId}`}>
          {l.studentName}
        </Link>
        <div className="text-xs text-slate-500">
          {l.className} – {l.sectionName} · {l.admissionNumber}
        </div>
      </Td>
      <Td>
        {l.fromDate === l.toDate ? formatDate(l.fromDate) : formatRange(l.fromDate, l.toDate)}
        <div className="text-xs text-slate-500">
          {l.days} day{l.days === 1 ? '' : 's'} · {VIA[l.requestedVia]}
        </div>
      </Td>
      <Td className="max-w-xs">
        {l.reason}
        {l.decisionNote && <div className="text-xs text-slate-500">Note: {l.decisionNote}</div>}
      </Td>
      <Td>
        <Badge tone={STATUS_TONE[l.status]}>{l.status[0]!.toUpperCase() + l.status.slice(1)}</Badge>
      </Td>
      <Td className="text-right">
        {action.error && <p className="mb-1 text-xs text-red-600">{action.error.message}</p>}
        {l.canDecide && l.status === 'pending' && !rejecting && (
          <div className="flex justify-end gap-1">
            <Button loading={action.pending} onClick={() => decide('approved')}>
              Approve
            </Button>
            <Button variant="secondary" onClick={() => setRejecting(true)}>
              Reject
            </Button>
          </div>
        )}
        {rejecting && (
          <div className="flex flex-col items-end gap-1">
            <Field
              label="Reason"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-48"
            />
            <div className="flex gap-1">
              <Button
                variant="danger"
                disabled={note.trim().length < 3}
                loading={action.pending}
                onClick={() => decide('rejected', note)}
              >
                Reject
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRejecting(false)}>
                Back
              </Button>
            </div>
          </div>
        )}
        {l.canDecide && (l.status === 'approved' || l.status === 'pending') && !rejecting && (
          <button
            className="mt-1 text-xs text-slate-500 underline"
            onClick={() => decide('cancelled')}
          >
            Cancel leave
          </button>
        )}
      </Td>
    </tr>
  );
}

function RecordLeave({ onDone }: { onDone: () => Promise<void> }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const found = useApi<{ data: StudentListItem[] }>(
    debounced.length >= 2 && !student
      ? `/students?limit=8&status=active&q=${encodeURIComponent(debounced)}`
      : null,
  );
  const action = useAction();
  const fields =
    action.error && Object.keys(action.error.fields).length ? action.error.fields : undefined;
  const today = localToday();

  return (
    <Card title="Record leave" description="From a parent's note, call or visit.">
      <form
        className="flex flex-col gap-4"
        onSubmit={onSubmitForm(async (f) => {
          if (!student) return;
          setDone(false);
          const ok = await action.run(() =>
            post('/attendance/leave', {
              studentId: student.id,
              fromDate: f.get('fromDate'),
              toDate: f.get('toDate'),
              reason: f.get('reason'),
              requestedVia: f.get('requestedVia'),
            }),
          );
          if (ok) {
            setDone(true);
            setStudent(null);
            setQ('');
            await onDone();
          }
        })}
      >
        {student ? (
          <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <span>
              <span className="font-medium">{fullName(student)}</span>
              <span className="text-slate-500">
                {' '}
                · {student.className} – {student.sectionName}
              </span>
            </span>
            <button
              type="button"
              className="text-xs text-brand-700 underline"
              onClick={() => setStudent(null)}
            >
              Change
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Field
              label="Student"
              placeholder="Name, admission no. or phone"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {found.data && (
              <ul className="max-h-56 overflow-auto rounded-lg border border-slate-200 text-sm">
                {found.data.data.length === 0 && (
                  <li className="px-3 py-2 text-slate-500">No matching students</li>
                )}
                {found.data.data.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left hover:bg-slate-50"
                      onClick={() => setStudent(s)}
                    >
                      {fullName(s)}{' '}
                      <span className="text-slate-500">
                        · {s.className} – {s.sectionName} · {s.admissionNumber}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="From"
            name="fromDate"
            type="date"
            required
            defaultValue={today}
            error={fields?.fromDate}
          />
          <Field
            label="To"
            name="toDate"
            type="date"
            required
            defaultValue={today}
            error={fields?.toDate}
          />
        </div>
        <Field
          label="Reason"
          name="reason"
          required
          minLength={3}
          maxLength={300}
          error={fields?.reason}
        />
        <SelectField label="Received" name="requestedVia" defaultValue="phone">
          <option value="office">At the office</option>
          <option value="phone">By phone</option>
          <option value="parent_app">Parent app</option>
        </SelectField>
        {action.error && !fields && <Alert>{action.error.message}</Alert>}
        {done && <Alert tone="success">Leave recorded. Approve it from the list.</Alert>}
        <Button type="submit" disabled={!student} loading={action.pending}>
          Record leave
        </Button>
      </form>
    </Card>
  );
}
