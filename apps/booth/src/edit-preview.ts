import { cssTransform, filterById, type EditParams } from '@photobooth/shared';

export function restorePhotoPreview(
  style: Pick<CSSStyleDeclaration, 'transform' | 'filter' | 'transition'>,
  edit: EditParams,
  size: { w: number; h: number },
) {
  style.transform = cssTransform(edit, size.w, size.h);
  style.filter = `brightness(${edit.brightness}) ${filterById(edit.filter).css}`;
  style.transition = 'none';
}
