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
};

export function Transport({ buffer, loop = null, label, onTime, seek = null }: Props) {
  const playerRef = useRef<BufferPlayer | null>(null);
  const [rawIsPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  // Losing the buffer stops the player, so the button must not stay on pause.
  const isPlaying = rawIsPlaying && Boolean(buffer);
  const onTimeRef = useRef(onTime);

  useEffect(() => {
    onTimeRef.current = onTime;
  }, [onTime]);

  useEffect(() => {
    const player = new BufferPlayer();
    player.onEnd = () => {
      setIsPlaying(false);
      setPosition(0);
    };
    playerRef.current = player;
    return () => player.dispose();
  }, []);

  useEffect(() => {
    playerRef.current?.load(buffer);
  }, [buffer]);

  useEffect(() => {
    playerRef.current?.setLoop(loop);
  }, [loop]);

  useEffect(() => {
    const player = playerRef.current;
    if (!seek || !player || !buffer) return;
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
