import { useEffect, useState } from 'react';
import { useOnlineSession } from '../hooks/useOnlineSession';
import { GuestSession } from '../net/guest';
import { HostSession } from '../net/host';
import { hostRoom, joinRoom } from '../net/peerTransport';
import { generateRoomCode, normalizeRoomCode, roomLink } from '../net/roomCode';
import type { OnlineSession, OnlineSnapshot } from '../net/session';
import type { ConnectionStatus } from '../net/transport';
import { loadName, loadSelection, savePracticeWords, saveName, saveSelection } from '../storage/selection';
import { useData } from '../decks/DataContext';
import { newDeck } from '../decks/types';
import { PlayerView } from './battle/PlayerView';
import { useBattleProgress, useDelayedFlag } from './OfflineGame';
import { CountdownOverlay } from './prepare/CountdownOverlay';
import { ItemPicker } from './prepare/ItemPicker';
import { WordPreview } from './prepare/WordPreview';
import { ResultScreen } from './ResultScreen';
import { TypingPlay, type RemoteLink } from './typing/TypingPlay';
import { TypingResult } from './typing/TypingResult';
import { CONTENT_KINDS, CONTENT_LABELS, type ContentKind } from '../typing/types';
import type { TypingResultData, TypingRule } from './typing/TypingPlay';

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
  const [typingResult, setTypingResult] = useState<TypingResultData | null>(null);
  const typingSeed = snap.typing?.seed;
  useEffect(() => setTypingResult(null), [typingSeed]);
  // Only the host's items carry deck ids, so only the host's FSRS progress changes.
  useBattleProgress(snap.phase === 'over' && session.role === 'host' ? snap.game : null, session.me, snap.words);

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

  // Luyện Gõ: each side plays its own field; the host decides the winner.
  if (snap.typing && (snap.phase === 'playing' || snap.phase === 'over')) {
    if (snap.phase === 'playing' || !snap.typingOver) {
      return <TypingPlay key={snap.typing.seed} items={snap.words} content={snap.typing.content} seed={snap.typing.seed} rule={snap.typing.rule} mode="online" remote={remoteLink(session, opponentName ?? 'Đối thủ')} deckLabel={`${snap.words.length} mục`} onFinish={(r) => setTypingResult(r)} />;
    }
    const won = snap.typingOver.winner === me;
    const data = typingResult ?? null;
    return (
      <TypingResult data={{ ...(data ?? EMPTY_TYPING), result: won ? 'win' : 'lose', reason: snap.typingOver.reason, content: snap.typing.content, mode: 'online' }}>
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
          <>
            <SaveDeckButton items={snap.words} hostName={snap.hostName} />
            <span className="muted">Chờ chủ phòng chọn chơi lại…</span>
          </>
        )}
        <button type="button" className="btn ghost" onClick={onMenu}>
          Rời phòng
        </button>
      </TypingResult>
    );
  }

  if ((snap.phase === 'playing' || (snap.phase === 'over' && !showResult)) && snap.game) {
    return (
      <div className="solo">
        <PlayerView
          state={snap.game}
          me={me}
          onAnswer={(q, i, ms) => session.submitAnswer(q, i, ms)}
          onSkip={isHost ? () => session.skipReveal() : undefined}
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
          <>
            <SaveDeckButton items={snap.words} hostName={snap.hostName} />
            <span className="muted">Chờ chủ phòng chọn chơi lại…</span>
          </>
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
  const [selection, setSelection] = useState(loadSelection);
  const prev = session.snapshot.typing;
  const [game, setGame] = useState<'quiz' | 'typing'>(prev ? 'typing' : 'quiz');
  const [content, setContent] = useState<ContentKind>(prev?.content ?? 'meaning');
  const [rule, setRule] = useState<TypingRule>(prev?.rule ?? 'hearts');
  return (
    <>
      <div className="card online-game-type">
        <div className="chips" role="radiogroup" aria-label="Kiểu trận">
          <button type="button" role="radio" aria-checked={game === 'quiz'} className={`chip ${game === 'quiz' ? 'on' : ''}`} onClick={() => setGame('quiz')}>
            ⚔️ Trắc nghiệm
          </button>
          <button type="button" role="radio" aria-checked={game === 'typing'} className={`chip ${game === 'typing' ? 'on' : ''}`} onClick={() => setGame('typing')}>
            ⌨️ Luyện Gõ
          </button>
        </div>
        {game === 'typing' && (
          <div className="chips">
            {CONTENT_KINDS.map((k) => (
              <button key={k} type="button" className={`chip ${content === k ? 'on' : ''}`} onClick={() => setContent(k)}>
                {CONTENT_LABELS[k]}
              </button>
            ))}
            <button type="button" className={`chip ${rule === 'hearts' ? 'on' : ''}`} onClick={() => setRule('hearts')}>
              ❤️ Hết tim thì thua
            </button>
            <button type="button" className={`chip ${rule === 'race' ? 'on' : ''}`} onClick={() => setRule('race')}>
              🏁 Đua mốc 20
            </button>
          </div>
        )}
      </div>
      <ItemPicker
        selection={selection}
        onChange={setSelection}
        onBack={onLeave}
        hideKinds={game === 'typing'}
        title={`Bạn chọn bộ từ cho cả hai. ${session.snapshot.guestName ?? 'Đối thủ'} sẽ xem nhưng không sửa được.`}
        onNext={(items, kinds) => {
          saveSelection(selection);
          savePracticeWords(items);
          // Full item content goes to the guest: they do not have the host's decks.
          session.setWordSet(items, kinds, game === 'typing' ? { type: 'typing', seed: (Math.random() * 2 ** 32) >>> 0, content, rule } : null);
        }}
      />
    </>
  );
}

const EMPTY_TYPING: TypingResultData = { result: 'lose', score: 0, milestone: 1, wpm: 0, accuracy: 1, maxCombo: 0, content: 'meaning', mode: 'online', outcomes: [] };

/** The play screen's view of the PeerJS session. */
function remoteLink(session: OnlineSession, opponentName: string): RemoteLink {
  return {
    opponentName,
    sendStatus: (s) => session.sendTypingStatus(s),
    sendAttack: (n) => session.sendTypingAttack(n),
    reportDone: (reason, milestone) => session.reportTypingDone(reason, milestone),
    onAttack: (cb) => session.onTyping((e) => e.type === 'attack' && cb(e.count)),
    onOpponent: (cb) => session.onTyping((e) => e.type === 'status' && cb({ name: opponentName, ...e.status })),
    onOver: (cb) =>
      session.subscribe((s) => {
        if (s.typingOver) cb(s.typingOver.winner === session.me, s.typingOver.reason);
      }),
  };
}

/** Guest after a match: keep the host's items as a new deck. */
function SaveDeckButton({ items, hostName }: { items: OnlineSnapshot['words']; hostName: string }) {
  const data = useData();
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const save = async () => {
    setState('saving');
    try {
      const clean = items.map(({ level, deckId, sourceId, ...it }) => (void level, void deckId, void sourceId, it));
      await data.importDeck(newDeck(`Trận với ${hostName || 'chủ phòng'}`, { items: clean }));
      setState('saved');
    } catch {
      setState('error');
    }
  };
  return (
    <button type="button" className="btn" disabled={state === 'saving' || state === 'saved'} onClick={() => void save()}>
      {state === 'saved' ? '✓ Đã lưu bộ' : state === 'error' ? 'Lỗi – thử lại' : '💾 Lưu bộ này'}
    </button>
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
