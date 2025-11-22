type PageKind = 'thread' | 'project-thread' | 'project' | 'unknown';

class PageClassifier {
    classify(pathname: string): PageKind {
        const path = pathname || '';
        const inProject = path.includes('/g/');
        const inThread = path.includes('/c/');
        if (inProject && inThread) return 'project-thread';
        if (inThread) return 'thread';
        if (inProject && /\/project\/?$/.test(path)) return 'project';
        return 'unknown';
    }
}
