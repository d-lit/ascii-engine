import './style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#view');
if (!canvas) throw new Error('#view canvas not found');
