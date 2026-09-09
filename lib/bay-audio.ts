/** Synthesized jet and wind ambience. Construct only inside a click handler. */
export function createBayAudio() {
  const context = new AudioContext();
  const master = context.createGain();
  master.gain.value = 0;
  master.connect(context.destination);
  const buffer = context.createBuffer(
    1,
    context.sampleRate * 4,
    context.sampleRate,
  );
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    last = (last + (Math.random() * 2 - 1) * 0.025) / 1.025;
    data[i] = last * 5;
  }
  const noise = context.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 180;
  noise.connect(filter).connect(master);
  noise.start();
  const turbine = context.createOscillator();
  turbine.type = 'sine';
  turbine.frequency.value = 58;
  const tone = context.createGain();
  tone.gain.value = 0.07;
  turbine.connect(tone).connect(master);
  turbine.start();
  void context.resume().catch(() => {});
  return {
    update(p: number, audible: boolean) {
      if (context.state === 'closed') return;
      const power = Math.min(1, Math.max(0, (p - 0.12) / 0.18));
      master.gain.setTargetAtTime(
        audible ? 0.1 + power * 0.13 : 0,
        context.currentTime,
        0.25,
      );
      filter.frequency.setTargetAtTime(
        230 + power * 1300,
        context.currentTime,
        0.4,
      );
      turbine.frequency.setTargetAtTime(
        58 + power * 48,
        context.currentTime,
        0.4,
      );
    },
    dispose() {
      void context.close().catch(() => {});
    },
  };
}
