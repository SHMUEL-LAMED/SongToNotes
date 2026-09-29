import { Pause, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatTime } from "../lib/audio";
import { BufferPlayer } from "../lib/bufferPlayer";

type Props = {
  buffer: AudioBuffer | null;
  loop?: { start: number; end: number } | null;
  label?: string;
  /** Called every animation frame while playing, for cursors elsewhere. */
  onTime?: (time: number) => void;
  /**
   * A request from outside to jump: a new `key` moves playback to `time`
   * (and starts it when `play` is set), so a chord or a lyric can be clicked.
   */
  seek?: { time: number; key: number; play?: boolean } | null;
  /**
   * The buffers are versions of one recording at different lengths (a speed
   * change): a new buffer keeps the playback position at the same fraction
   * of the length, so it stays on the same bar of the song.
   */
  keepRelativePosition?: boolean;
};

export function Transport({
  buffer,
  loop = null,
  label,
  onTime,
  seek = null,
  keepRelativePosition = false,
}: Props) {
  const playerRef = useRef<BufferPlayer | null>(null);
  const [rawIsPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  // Losing the buffer stops the player, so the button must not stay on pause.
  const isPlaying = rawIsPlaying && Boolean(buffer);
  const onTimeRef = useRef(onTime);
  const keepRelativeRef = useRef(keepRelativePosition);

  useEffect(() => {
    onTimeRef.current = onTime;
    keepRelativeRef.current = keepRelativePosition;
  }, [onTime, keepRelativePosition]);

  useEffect(() => {
    const player = new BufferPlayer();
    player.onEnd = () => {
      setIsPlaying(false);
      setPosition(0);
    };
    playerRef.current = player;
    return () => player.dispose();
  }, []);

  // Tools that re-render their output (a new speed, a new fade) pass null
  // while the next buffer is being made. The player is emptied meanwhile,
  // which also rewinds it, so where it stood — and whether it was playing —
  // is kept here and put back once the new buffer arrives. Without it the
  // button went on showing "pause" over silence, the first click on it
  // started playback instead of pausing, and a paused position was lost.
  const gapRef = useRef<{ time: number; playing: boolean } | null>(null);
  const lastDurationRef = useRef(0);
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (!buffer) {
      if (!gapRef.current && lastDurationRef.current > 0) {
        gapRef.current = { time: player.currentTime, playing: player.isPlaying };
      }
      player.load(null);
      return;
    }
    const previousDuration = lastDurationRef.current;
    lastDurationRef.current = buffer.duration;
    const gap = gapRef.current;
    gapRef.current = null;
    const time = gap ? gap.time : player.currentTime;
    const wasPlaying = gap ? gap.playing : player.isPlaying;
    player.load(buffer);
    let target = time;
    // A stretched copy of the same song: the same point in the music sits at
    // the same fraction of the length, not at the same second.
    if (keepRelativeRef.current && previousDuration > 0) {
      target = (time * buffer.duration) / previousDuration;
    }
    if (target >= buffer.duration) target = 0;
    if (!gap && target === time) return;
    if (wasPlaying && !player.isPlaying) {
      void player.play(target).then((started) => setIsPlaying(started));
    } else {
      player.seek(target);
    }
    setPosition(target);
    onTimeRef.current?.(target);
  }, [buffer]);

  // Compared by value: a caller that builds the loop inline hands over a new
  // object on every render, and each one used to restart the source — an
  // audible hiccup on every progress tick of whatever else was re-rendering.
  const loopStart = loop?.start ?? null;
  const loopEnd = loop?.end ?? null;
  useEffect(() => {
    playerRef.current?.setLoop(
      loopStart !== null && loopEnd !== null ? { start: loopStart, end: loopEnd } : null,
    );
  }, [loopStart, loopEnd]);

  // The request last carried out, and on which player: the buffer is a
  // dependency below, and a new buffer must not replay an old jump.
  const handledSeekRef = useRef<{ seek: Props["seek"]; player: BufferPlayer | null }>({
    seek: null,
    player: null,
  });
  useEffect(() => {
    const player = playerRef.current;
    if (!seek || !player || !buffer) return;
    const handled = handledSeekRef.current;
    if (handled.seek === seek && handled.player === player) return;
    handledSeekRef.current = { seek, player };
    player.seek(seek.time);
    setPosition(seek.time);
    onTimeRef.current?.(seek.time);
    if (seek.play && !player.isPlaying) {
      void player.play(seek.time).then((started) => setIsPlaying(started));
    }
    // Only a new request (a new key) should jump; the buffer is here so a
    // request made before the buffer loaded is honoured once it has.
  }, [seek, buffer]);

  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0;
    const tick = () => {
      const time = playerRef.current?.currentTime ?? 0;
      setPosition(time);
      onTimeRef.current?.(time);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying]);

  const duration = buffer?.duration ?? 0;

  return (
    <div className="transport">
      <button
        className="transport-button primary"
        type="button"
        disabled={!buffer}
        onClick={() => {
          const player = playerRef.current;
          if (!player) return;
          if (player.isPlaying) {
            player.pause();
            setIsPlaying(false);
          } else {
            // Only flip the button once the player confirms it started, so a
            // browser that refuses to open an audio context does not leave a
            // pause button sitting over silence.
            void player.play().then((started) => setIsPlaying(started));
          }
        }}
        aria-label={isPlaying ? "השהה" : "נגן"}
      >
        {isPlaying ? <Pause size={19} /> : <Play size={19} />}
        {isPlaying ? "השהה" : label ?? "נגן"}
      </button>
      <button
        className="transport-button"
        type="button"
        disabled={!buffer}
        onClick={() => {
          playerRef.current?.stop();
          setIsPlaying(false);
          setPosition(0);
          onTimeRef.current?.(0);
        }}
        aria-label="עצור"
      >
        <Square size={16} />
      </button>
      <input
        className="transport-seek"
        type="range"
        min={0}
        max={Math.max(0.1, duration)}
        step={0.01}
        value={Math.min(position, duration)}
        disabled={!buffer}
        onChange={(event) => {
          const time = Number(event.target.value);
          playerRef.current?.seek(time);
          setPosition(time);
          onTimeRef.current?.(time);
        }}
        aria-label="מיקום הנגינה"
      />
      <span className="transport-time">
        {formatTime(position)} / {formatTime(duration)}
      </span>
    </div>
  );
}
