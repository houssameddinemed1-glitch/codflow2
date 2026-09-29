import { fileURLToPath } from "node:url";
import { defineConfig, envField } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import vercel from "@astrojs/vercel";

const orderDetailFallback = {
  name: "order-detail-static-fallback",
  configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      const pathname = request.url?.split("?", 1)[0] ?? "";
       const isOrderDetail = /^\/orders\/[^/]+\/?$/.test(pathname) && pathname !== "/orders/new" && pathname !== "/orders/abandoned";
       const isCustomerDetail = /^\/customers\/[^/]+(?:\/edit)?\/?$/.test(pathname) && pathname !== "/customers/new";
       const isCustomerGroupDetail = /^\/customer-groups\/[^/]+(?:\/edit)?\/?$/.test(pathname) && pathname !== "/customer-groups/new";
       const isCustomerTagDetail = /^\/customer-tags\/[^/]+(?:\/edit)?\/?$/.test(pathname) && pathname !== "/customer-tags/new";
       const isProductDetail = /^\/products\/[^/]+(?:\/edit)?\/?$/.test(pathname) && pathname !== "/products/new" && pathname !== "/products/stock";
       const isProductGroupEdit = /^\/product-groups\/[^/]+\/edit\/?$/.test(pathname);
       const isOfferEdit = /^\/offers\/[^/]+\/?$/.test(pathname) && pathname !== "/offers/new";
       const isDriverRoute = /^\/delivery\/drivers\/[^/]+(?:\/(edit|compensations))?\/?$/.test(pathname) && pathname !== "/delivery/drivers/new";
       const isDeliveryCompanyRoute = /^\/delivery\/companies\/[^/]+(?:\/(credentials|stop-desks))?\/?$/.test(pathname);
       const isShippingProfileRoute = /^\/delivery\/shipping-profiles\/[^/]+(?:\/edit)?\/?$/.test(pathname) && pathname !== "/delivery/shipping-profiles/new";
       const isTeamMemberRoute = /^\/team\/[^/]+\/?$/.test(pathname);
       const isLandingPageStudio = /^\/landing-pages\/[^/]+\/studio\/?$/.test(pathname);
       if (isOrderDetail || isCustomerDetail || isCustomerGroupDetail || isCustomerTagDetail || isProductDetail || isProductGroupEdit || isOfferEdit || isDriverRoute || isDeliveryCompanyRoute || isShippingProfileRoute || isTeamMemberRoute || isLandingPageStudio) {
         request.url = "/";
       }
      next();
    });
  },
};

// Static-first: every page prerenders at build time except routes that opt out
// with `export const prerender = false` (/api/auth/*, /mcp/oauth/login,
// /reset-password/*). Those become Vercel serverless functions.
export default defineConfig({
  output: "static",
  env: {
    schema: {
      PUBLIC_API_URL: envField.string({ context: "client", access: "public" }),
    },
  },
  integrations: [react()],
  adapter: vercel(),
  vite: {
    plugins: [orderDetailFallback, tailwindcss()],
    ssr: {
      noExternal: ["drizzle-orm", "@neondatabase/serverless"],
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "@neondatabase/serverless": fileURLToPath(
          new URL("./node_modules/@neondatabase/serverless", import.meta.url),
        ),
      },
    },
  },
});
