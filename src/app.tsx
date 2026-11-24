import React from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { TooltipProvider } from './components/tooltip/tooltip';
import { HelmetData } from './helmet/helmet-data';
import { HelmetProvider } from 'react-helmet-async';
import { AccentProvider } from './context/accent-context/accent-provider';

export const App = () => {
    return (
        <HelmetProvider>
            <HelmetData />
            <AccentProvider>
                <TooltipProvider>
                    <RouterProvider router={router} />
                </TooltipProvider>
            </AccentProvider>
        </HelmetProvider>
    );
};
