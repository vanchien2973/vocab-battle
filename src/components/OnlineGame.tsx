import { useEffect, useState } from 'react';
import { resolveWords } from '../data/catalog';
import { useOnlineSession } from '../hooks/useOnlineSession';
import { GuestSession } from '../net/guest';
import { HostSession } from '../net/host';
import { hostRoom, joinRoom } from '../net/peerTransport';
import { generateRoomCode, normalizeRoomCode, roomLink } from '../net/roomCode';
import type { OnlineSession, OnlineSnapshot } from '../net/session';
import type { ConnectionStatus } from '../net/transport';
import { loadName, loadSelection, saveName, saveSelection } from '../storage/selection';
import { PlayerView } from './battle/PlayerView';
import { useDelayedFlag } from './OfflineGame';
import { CountdownOverlay } from './prepare/CountdownOverlay';
import { WordPicker } from './prepare/WordPicker';
import { WordPreview } from './prepare/WordPreview';
import { ResultScreen } from './ResultScreen';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Đang kết nối…',
  waiting: 'Đang chờ đối thủ…',
  connected: 'Đã kết nối',
  disconnected: 'Mất kết nối',
  error: 'Lỗi kết nối',
};

function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  return <span className={`conn conn-${status}`}>● {STATUS_LABEL[status]}</span>;
}

interface Props {
  initialRoom: string | null;
  onMenu: () => void;
}

export function OnlineGame({ initialRoom, onMenu }: Props) {
  const [session, setSession] = useState<OnlineSession | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);

  // Leave the room when this screen unmounts (back to menu, tab closed in-app).
  useEffect(() => () => session?.leave(), [session]);

  const exit = () => {
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
    onMenu();
  };

  if (!session) {
    return (
      <JoinForm
        initialRoom={initialRoom}
        onBack={exit}
        onCreate={(name) => {
          const code = generateRoomCode();
          setRoomCode(code);
          setSession(new HostSession(hostRoom(code), name));
        }}
        onJoin={(name, code) => {
          setRoomCode(code);
          setSession(new GuestSession(joinRoom(code), name));
        }}
      />
    );
  }

  return (
    <OnlineRoom
      session={session}
      roomCode={roomCode!}
      onRetry={() => setSession(null)}
      onMenu={exit}
    />
  );
}

function JoinForm({
  initialRoom,
  onBack,
  onCreate,
  onJoin,
}: {
  initialRoom: string | null;
  onBack: () => void;
  onCreate: (name: string) => void;
  onJoin: (name: string, code: string) => void;
}) {
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState(initialRoom ?? '');
  const valid = normalizeRoomCode(code);
  const remember = () => saveName(name.trim());

  return (
    <div className="menu">
      <h1 className="logo">
        🌐 Online <span>1v1</span>
      </h1>
      <div className="card setup">
        <label>
          Tên của bạn
          <input className="input" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="Nhập tên" />
        </label>
        {!initialRoom && (
          <button
            type="button"
            className="btn primary big"
            onClick={() => {
              remember();
              onCreate(name);
            }}
          >
            ➕ Tạo phòng
          </button>
        )}
        <div className="divider">{initialRoom ? 'Vào phòng được mời' : 'hoặc vào phòng có sẵn'}</div>
        <form
          className="join"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            remember();
            onJoin(name, valid);
          }}
        >
          <input
            className="input code"
            value={code}
            maxLength={8}
            placeholder="MÃ PHÒNG"
            autoCapitalize="characters"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button type="submit" className={`btn ${initialRoom ? 'primary' : ''}`} disabled={!valid}>
            Vào phòng
          </button>
        </form>
      </div>
      <button type="button" className="btn ghost" onClick={onBack}>
        ← Menu
      </button>
    </div>
  );
}

function OnlineRoom({
  session,
  roomCode,
  onRetry,
  onMenu,
}: {
  session: OnlineSession;
  roomCode: string;
  onRetry: () => void;
  onMenu: () => void;
}) {
  const snap = useOnlineSession(session)!;
  const isHost = session instanceof HostSession;
  const showResult = useDelayedFlag(snap.phase === 'over', 1200);

  // Opponent left → notify, then return to the menu.
  useEffect(() => {
    if (!snap.opponentLeft) return;
    const t = setTimeout(onMenu, 5000);
    return () => clearTimeout(t);
  }, [snap.opponentLeft, onMenu]);

  if (snap.opponentLeft) {
    return (
      <Notice title="Đối thủ đã rời phòng" text="Đang quay về menu…">
        <button type="button" className="btn primary" onClick={onMenu}>
          Về menu ngay
        </button>
      </Notice>
    );
  }

  if (snap.status === 'error') {
    return (
      <Notice title="Không kết nối được" text={snap.error ?? 'Kết nối thất bại. Hãy thử mạng khác.'}>
        <button type="button" className="btn primary" onClick={onRetry}>
          Thử lại
        </button>
        <button type="button" className="btn ghost" onClick={onMenu}>
          Menu
        </button>
      </Notice>
    );
  }

  const opponentName = isHost ? snap.guestName : snap.hostName;
  const me = session.me;

  if ((snap.phase === 'playing' || (snap.phase === 'over' && !showResult)) && snap.game) {
    return (
      <div className="solo">
        <PlayerView
          state={snap.game}
          me={me}
          onAnswer={(q, i, ms) => session.submitAnswer(q, i, ms)}
        />
        <div className="conn-float">
          <ConnectionBadge status={snap.status} />
        </div>
      </div>
    );
  }

  if (snap.phase === 'over' && snap.game) {
    return (
      <ResultScreen state={snap.game} mode="online" viewers={[me]} words={snap.words}>
        {session instanceof HostSession ? (
          <>
            <button type="button" className="btn primary" onClick={() => session.rematch()}>
              🔁 Chơi lại
            </button>
            <button type="button" className="btn" onClick={() => session.beginSelecting()}>
              Đổi bộ từ
            </button>
          </>
        ) : (
          <span className="muted">Chờ chủ phòng chọn chơi lại…</span>
        )}
        <button type="button" className="btn ghost" onClick={onMenu}>
          Rời phòng
        </button>
      </ResultScreen>
    );
  }

  if (snap.phase === 'preview' || snap.phase === 'countdown') {
    return (
      <>
        <PreviewStep session={session} snap={snap} opponentName={opponentName ?? 'Đối thủ'} />
        <CountdownOverlay value={snap.countdown} />
      </>
    );
  }

  if (snap.phase === 'selecting' && session instanceof HostSession) {
    return <HostPicker session={session} onLeave={onMenu} />;
  }

  // Lobby (and guest waiting while the host picks words).
  const link = roomLink(roomCode, window.location.origin, import.meta.env.BASE_URL);
  return (
    <div className="menu">
      <h1 className="logo">
        🌐 Phòng <span>{roomCode}</span>
      </h1>
      <ConnectionBadge status={snap.status} />
      {isHost && (
        <div className="card room">
          <p className="muted">Gửi mã hoặc link cho bạn của bạn:</p>
          <div className="room-code">{roomCode}</div>
          <CopyButton text={link} />
        </div>
      )}
      <div className="card players">
        <div>
          👑 {snap.hostName || '…'} {isHost && <span className="muted">(bạn)</span>}
        </div>
        <div>
          🎮 {snap.guestName && (isHost || snap.status === 'connected') ? snap.guestName : <span className="muted">đang chờ…</span>}{' '}
          {!isHost && <span className="muted">(bạn)</span>}
        </div>
      </div>
      {session instanceof HostSession ? (
        <button type="button" className="btn primary big" disabled={!snap.guestName || snap.status !== 'connected'} onClick={() => session.beginSelecting()}>
          Bắt đầu: chọn từ vựng →
        </button>
      ) : (
        <p className="muted">{snap.phase === 'selecting' ? '📝 Chủ phòng đang chọn bộ từ…' : 'Chờ chủ phòng bắt đầu…'}</p>
      )}
      <button type="button" className="btn ghost" onClick={onMenu}>
        Rời phòng
      </button>
    </div>
  );
}

function HostPicker({ session, onLeave }: { session: HostSession; onLeave: () => void }) {
  const [ids, setIds] = useState<string[]>(() =>
    session.snapshot.words.length ? session.snapshot.words.map((w) => w.id) : loadSelection(),
  );
  return (
    <WordPicker
      selected={ids}
      onChange={setIds}
      onBack={onLeave}
      title={`Bạn chọn bộ từ cho cả hai. ${session.snapshot.guestName ?? 'Đối thủ'} sẽ xem nhưng không sửa được.`}
      onNext={() => {
        saveSelection(ids);
        // Send full word content: the guest may not have the host's saved "Của tôi" words.
        session.setWordSet(resolveWords(ids));
      }}
    />
  );
}

function PreviewStep({ session, snap, opponentName }: { session: OnlineSession; snap: OnlineSnapshot; opponentName: string }) {
  const isHost = session instanceof HostSession;
  const mine = isHost ? snap.ready.host : snap.ready.guest;
  const theirs = isHost ? snap.ready.guest : snap.ready.host;
  const locked = snap.phase === 'countdown';
  return (
    <WordPreview
      words={snap.words}
      onBack={session instanceof HostSession && !locked ? () => session.beginSelecting() : undefined}
      note={!isHost && <p className="muted">Bộ từ do chủ phòng chọn (chỉ xem).</p>}
    >
      <span className={`opp-ready ${theirs ? 'on' : ''}`}>
        {opponentName}: {theirs ? '✓ Sẵn sàng' : '… chưa sẵn sàng'}
      </span>
      <button type="button" className={`btn ${mine ? 'ready' : 'primary'}`} disabled={locked} onClick={() => session.setReady(!mine)}>
        {mine ? '✓ Đã sẵn sàng' : 'Sẵn sàng'}
      </button>
    </WordPreview>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt('Sao chép link này:', text);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button type="button" className="btn" onClick={copy}>
      {copied ? '✓ Đã copy link' : '🔗 Copy link mời'}
    </button>
  );
}

function Notice({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="menu">
      <div className="card notice">
        <h2>{title}</h2>
        <p>{text}</p>
        <div className="actions">{children}</div>
      </div>
    </div>
  );
}
