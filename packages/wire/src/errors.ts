export class FrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
