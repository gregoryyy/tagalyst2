/// <reference path="../../types/domain.d.ts" />
/// <reference path="../dom/chatgpt-adapter.ts" />

type AdapterDescriptor = {
    name: string;
    supports: (loc: Location) => boolean;
    create: () => ThreadAdapter;
};

/**
 * Registry for selecting the appropriate thread adapter per page.
 */
class ThreadAdapterRegistry {
    private adapters: AdapterDescriptor[] = [];

    register(descriptor: AdapterDescriptor) {
        this.adapters.push(descriptor);
    }

    getAdapterForLocation(loc: Location): ThreadAdapter | null {
        const match = this.adapters.find(ad => {
            try {
                return ad.supports(loc);
            } catch {
                return false;
            }
        });
        return match ? match.create() : null;
    }
} // ThreadAdapterRegistry

(globalThis as any).ThreadAdapterRegistry = ThreadAdapterRegistry;
