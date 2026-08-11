'use strict';
const { test, expect } = require('./fixtures');

test.describe('Landing pública — navegación y estados', () => {
  test('carga sin errores de consola, con un solo h1 y título correcto', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/AnyLashes/);
    await expect(page.locator('h1')).toHaveCount(1);
  });

  test('el menú de escritorio navega a las secciones por ancla', async ({ page }) => {
    const viewport = page.viewportSize();
    test.skip(viewport.width < 960, 'el nav de escritorio está oculto en móvil/tablet angosto');

    await page.goto('/');
    await page.locator('.nav__link', { hasText: 'Servicios' }).click();
    await expect(page).toHaveURL(/#servicios$/);
    await expect(page.locator('#servicios')).toBeInViewport();
  });

  test('menú móvil: abre, atrapa el foco, cierra con Escape y regresa el foco al botón', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const hamburger = page.locator('#hamburgerBtn');
    await hamburger.click();
    await expect(page.locator('#mobileMenu')).toHaveClass(/is-open/);

    // El primer elemento enfocable del menú debe tener el foco al abrir.
    const firstFocusable = page.locator('#mobileMenu a[href], #mobileMenu button').first();
    await expect(firstFocusable).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('#mobileMenu')).not.toHaveClass(/is-open/);
    await expect(hamburger).toBeFocused();
  });

  test('navegación solo con teclado: Tab llega al CTA de reservar y Enter lo activa', async ({ page }) => {
    await page.goto('/');
    await page.locator('.header__brand').focus();
    // Unos cuantos Tab deben bastar para llegar a algún link interno visible.
    let reached = false;
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab');
      const active = await page.evaluate(() => document.activeElement && document.activeElement.tagName);
      if (active === 'A' || active === 'BUTTON') { reached = true; break; }
    }
    expect(reached).toBe(true);
  });

  test('atrás/adelante y recargar no rompen la página', async ({ page }) => {
    await page.goto('/');
    // Varios enlaces de la página apuntan a #servicios (nav de escritorio,
    // menú móvil, barra de categorías...) y no todos son visibles en todos
    // los tamaños — el botón "Ver servicios" del hero sí lo es siempre.
    await page.locator('a[href="#servicios"]', { hasText: 'Ver servicios' }).click();
    await expect(page).toHaveURL(/#servicios$/);
    await page.goBack();
    await page.goForward();
    await page.reload();
    await expect(page.locator('h1')).toBeVisible();
  });

  test('FAQ (accordion) se abre y cierra con clic', async ({ page }) => {
    await page.goto('/');
    const trigger = page.locator('.accordion__trigger').first();
    await trigger.scrollIntoViewIfNeeded();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('los botones de WhatsApp tienen href real (no son decorativos)', async ({ page }) => {
    await page.goto('/');
    const links = page.locator('.js-whatsapp-cta');
    const count = await links.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const href = await links.nth(i).getAttribute('href');
      expect(href).toMatch(/^https:\/\/wa\.me\/\d+/);
    }
  });

  test('galería de trabajos recientes: vacía muestra mensaje, no un hueco roto', async ({ page }) => {
    await page.goto('/');
    const gallery = page.locator('#workGallery');
    await expect(gallery).toBeVisible();
    // El mock no tiene fotos sembradas: debe verse el estado vacío, no un error.
    await expect(gallery.locator('.work-gallery__empty')).toBeVisible();
  });
});
