// 登录后回到来时的应用地址；只接受 /app 开头的站内路径，防止 ?next= 被拼成开放重定向
export function safeNext(search) {
  const next = new URLSearchParams(search).get('next');
  return next && /^\/app(?:[/?#]|$)/.test(next) ? next : '/app';
}
