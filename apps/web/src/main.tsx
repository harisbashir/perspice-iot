import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { createQueryClient } from './api/query';
import { AuthProvider } from './auth/AuthProvider';
import { BrandingProvider } from './branding/BrandingProvider';
import { Toaster } from './components/ui/toast';
import { TooltipProvider } from './components/ui/tooltip';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import './index.css';
import { createRouter } from './router';

const queryClient = createQueryClient();
const router = createRouter();

// Demo mode mocks the API before anything fetches (see vite.config.ts); dropped from real builds.
const ready = import.meta.env.DEMO ? import('./demo/start').then((m) => m.startDemo()) : Promise.resolve();

void ready.then(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrandingProvider>
        <AuthProvider>
          <TooltipProvider delayDuration={300}>
            <Toaster>
              <RouterProvider router={router} />
            </Toaster>
          </TooltipProvider>
        </AuthProvider>
      </BrandingProvider>
    </QueryClientProvider>
  </StrictMode>,
));
