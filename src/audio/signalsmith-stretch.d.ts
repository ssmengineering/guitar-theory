/**
 * The package ships no types. The node it resolves to is an AudioWorkletNode
 * with methods attached at runtime; `engine.ts` narrows it to the ones it uses.
 */
declare module 'signalsmith-stretch' {
  const SignalsmithStretch: (
    context: BaseAudioContext,
    options?: AudioWorkletNodeOptions,
  ) => Promise<AudioWorkletNode>
  export default SignalsmithStretch
}
