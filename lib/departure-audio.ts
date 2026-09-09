/** Quiet synthesized propeller and wind ambience, enabled only by a user gesture. */
export function startDepartureAudio() {
  const context = new AudioContext();
  const master = context.createGain();
  master.gain.setValueAtTime(0, context.currentTime);
  master.gain.linearRampToValueAtTime(0.16, context.currentTime + 1.5);
  master.gain.linearRampToValueAtTime(0.2, context.currentTime + 4);
  master.gain.linearRampToValueAtTime(0, context.currentTime + 9.2);
  master.connect(context.destination);
  const buffer = context.createBuffer(
    1,
    context.sampleRate * 3,
    context.sampleRate,
  );
  const data = buffer.getChannelData(0);
  let previous = 0;
  for (let i = 0; i < data.length; i++) {
    previous = (previous + (Math.random() * 2 - 1) * 0.03) / 1.03;
    data[i] = previous * 4;
  }
  const wind = context.createBufferSource();
  wind.buffer = buffer;
  wind.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(180, context.currentTime);
  filter.frequency.exponentialRampToValueAtTime(1100, context.currentTime + 6);
  wind.connect(filter).connect(master);
  wind.start();
  const motor = context.createOscillator();
  motor.type = 'sine';
  motor.frequency.setValueAtTime(43, context.currentTime);
  motor.frequency.linearRampToValueAtTime(91, context.currentTime + 5);
  const motorGain = context.createGain();
  motorGain.gain.value = 0.2;
  motor.connect(motorGain).connect(master);
  motor.start();
  void context.resume().catch(() => {});
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    void context.close().catch(() => {});
  };
}
