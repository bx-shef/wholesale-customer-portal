<?php
// Заглушка docroot сайта ЛК на ВМ Битрикс24. Сюда запрос доходит, только если сломалось
// проксирование nginx → docker (00-app-proxy.conf). Логики нет и быть не должно: каталог
// обслуживает PHP портала, любой код здесь работал бы рядом с боевым Битрикс24.
// 503, а не 200: «не обслуживается» — честный ответ мониторингу.
http_response_code(503);
header('Content-Type: text/plain; charset=utf-8');
header('Retry-After: 60');
header('X-Robots-Tag: noindex, nofollow');
echo "Service is temporarily unavailable\n";
