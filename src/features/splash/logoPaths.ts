// Geometry of the IGrasp mark (viewBox 0 0 512 512), shared by the components and kept in sync
// with assets/branding/*.svg.

export const LOGO_PATHS = {
  page: 'M192 128H312L352 168V368Q352 384 336 384H192Q176 384 176 368V144Q176 128 192 128Z',
  fold: 'M312 128V156Q312 168 324 168H352Z',
  /** One continuous stroke (arc, then the thumb) so the draw animation runs end to end. */
  grip: 'M365 126A170 170 0 1 0 426 256H322',
};
