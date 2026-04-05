import React, { createContext, useContext, useState, ReactNode } from 'react';
import { Capability } from '../types';
import { CAPABILITIES } from '../constants';

interface CapabilityContextType {
  activeCapability: Capability;
  setActiveCapability: (capability: Capability) => void;
  capabilities: Capability[];
  addCapability: (capability: Capability) => void;
}

const CapabilityContext = createContext<CapabilityContextType | undefined>(undefined);

export const CapabilityProvider = ({ children }: { children: ReactNode }) => {
  const [capabilities, setCapabilities] = useState<Capability[]>(CAPABILITIES);
  const [activeCapability, setActiveCapability] = useState<Capability>(CAPABILITIES[0]);

  const addCapability = (newCap: Capability) => {
    setCapabilities(prev => [...prev, newCap]);
  };

  return (
    <CapabilityContext.Provider value={{ 
      activeCapability, 
      setActiveCapability, 
      capabilities,
      addCapability
    }}>
      {children}
    </CapabilityContext.Provider>
  );
};

export const useCapability = () => {
  const context = useContext(CapabilityContext);
  if (context === undefined) {
    throw new Error('useCapability must be used within a CapabilityProvider');
  }
  return context;
};
